import type { BackgroundItem } from "./shared";
import type { BackgroundSnapshot } from "./shared";
import { enqueue as queueItemWrite } from "../storage/coordinator";
import { STORAGE_KEY, ORDER_KEY, SETTINGS_KEY, COVERS_KEY } from "./shared";
import { resetActionAppearance } from "./feedback";

// ── 自动清除过期的「已读」收藏 ────────────────────────────────
// 从「标为已读的那一天」起算，超过设定天数（默认 30 天，30–180 天可调）就自动删掉，
// 默认开启；关闭时保留所有已读收藏（包括归档项目），不改动原有天数和 doneAt。
const CLEAN_ALARM = "laterOnAutoClean";
const DAY_MS = 24 * 60 * 60 * 1000;
const CLEAN_MIN_DAYS = 30;
const CLEAN_MAX_DAYS = 180;
const CLEAN_DEFAULT_DAYS = 30;

function normalizeCleanDays(value: unknown): number {
  const days = Number(value);
  if (!Number.isFinite(days)) return CLEAN_DEFAULT_DAYS;
  return Math.min(CLEAN_MAX_DAYS, Math.max(CLEAN_MIN_DAYS, Math.round(days)));
}

// 兼容老数据：1.40 之前没有 status 字段，只有 read 布尔。
function isDoneItem(item: BackgroundItem | null | undefined): boolean {
  if (!item) return false;
  if (item.status) return item.status === "done";
  return item.read === true;
}

export async function purgeExpiredItems() {
  return queueItemWrite(purgeExpiredItemsNow);
}

async function purgeExpiredItemsNow() {
  try {
    const stored = await chrome.storage.local.get<BackgroundSnapshot>([STORAGE_KEY, ORDER_KEY, SETTINGS_KEY, COVERS_KEY]);
    const settings = stored[SETTINGS_KEY] || {};
    // 缺少开关的旧设置仍沿用已开启的行为。
    if (settings.autoCleanEnabled === false) return 0;
    const items = stored[STORAGE_KEY] || [];
    const days = normalizeCleanDays(settings.autoCleanDays);
    const cutoff = Date.now() - days * DAY_MS;
    // 没有 doneAt 的（本版本之前就标成已读的老收藏）一律不动，避免升级后误删一片。
    const expiredIds = new Set(
      items.filter((item) => isDoneItem(item) && Number(item.doneAt) > 0 && Number(item.doneAt) < cutoff)
        .map((item) => item.id)
    );
    if (!expiredIds.size) return 0;
    const kept = items.filter((item) => !expiredIds.has(item.id));
    const orders = stored[ORDER_KEY] || {};
    const nextOrders: Record<string, readonly string[]> = {};
    for (const [scope, list] of Object.entries(orders)) {
      nextOrders[scope] = Array.isArray(list) ? list.filter((id) => !expiredIds.has(id)) : list;
    }
    // 过期收藏删掉了，它们自己上传的封面也要跟着删，别在存储里占地方。
    const covers = stored[COVERS_KEY] || {};
    const nextCovers: Record<string, string> = {};
    for (const [id, data] of Object.entries(covers)) {
      if (!expiredIds.has(id)) nextCovers[id] = data;
    }
    // 设置页不走收藏写队列：提交前重读策略，放弃已关闭或期限已改变的清理。
    const latest = (await chrome.storage.local.get<BackgroundSnapshot>(SETTINGS_KEY))[SETTINGS_KEY] || {};
    if (latest.autoCleanEnabled === false || normalizeCleanDays(latest.autoCleanDays) !== days) return 0;
    await chrome.storage.local.set({ [STORAGE_KEY]: kept, [ORDER_KEY]: nextOrders, [COVERS_KEY]: nextCovers });
    return expiredIds.size;
  } catch {
    return 0;
  }
}

export async function ensureLegacyCleanup() {
  const flagKey = "laterOnCleanupV165";
  const stored = await chrome.storage.local.get<BackgroundSnapshot>(flagKey);
  if (stored[flagKey]) return;
  await cleanupLegacyContent();
  // “最近在看”已撤下；升级时顺手删除曾经保存的 id 列表，不留下无用数据。
  await chrome.storage.local.remove("laterOnRecentItems");
  await chrome.storage.local.set({ [flagKey]: true });
}

// 一次性迁移清理：1.14.0 起不再保存网页正文，把旧版本可能残留的
// contentHtml / wordCount / byline 字段从已有收藏上移除，释放本地空间。
async function cleanupLegacyContent() {
  return queueItemWrite(async () => {
    const result = await chrome.storage.local.get<BackgroundSnapshot>(STORAGE_KEY);
    const items = result[STORAGE_KEY] || [];
    let changed = false;
    const cleaned = items.map((item) => {
      if (!("contentHtml" in item) && !("wordCount" in item) && !("byline" in item)) return item;
      const { contentHtml: _contentHtml, wordCount: _wordCount, byline: _byline, ...rest } = item;
      changed = true;
      return rest;
    });
    if (changed) await chrome.storage.local.set({ [STORAGE_KEY]: cleaned });
  });
}

export function registerMaintenance() {
  // 定时跑：服务worker 会被浏览器回收，用 alarms 才能在后台稳定触发。
  // 每 12 小时扫一次（粒度足够，删除时间差半天不影响体验）。
  if (chrome.alarms) {
    chrome.alarms.onAlarm?.addListener((alarm) => {
      if (alarm?.name === CLEAN_ALARM) purgeExpiredItems().catch(() => {});
    });
    chrome.alarms.create?.(CLEAN_ALARM, { delayInMinutes: 2, periodInMinutes: 720 });
  }

  // 扩展启动 / service worker 每次被唤醒时也顺手扫一遍。
  purgeExpiredItems().catch(() => {});

  // 设置里重新开启或调整天数立即生效（不用等下一次定时）。
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes[SETTINGS_KEY]) purgeExpiredItems().catch(() => {});
    if (area === "local" && changes[SETTINGS_KEY]) resetActionAppearance().catch(() => {});
  });

  // 一次性迁移（1.14.0）：清掉旧版本保存的网页正文字段。
  // 不依赖 onInstalled —— 因为「重新加载扩展」不会触发 onInstalled，
  // 这里放在脚本启动时执行，并用标记位保证只真正清理一次。
  ensureLegacyCleanup().catch(() => {});
}
