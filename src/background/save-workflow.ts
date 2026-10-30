import type { BackgroundTab, ResolvedProject, BatchOptions, BackgroundItem } from "./shared";
import type { BackgroundSnapshot } from "./shared";
import { errorMessage } from "./shared";
import { unwrapSuspendedTab, normalize as normalizeUrl } from "../shared/url-utils";
import { usesEnglish, isWebUrl, STORAGE_KEY, safeHostname, SETTINGS_KEY, LAST_PROJECT_KEY, PENDING_KEY, withTimeout, PROJECTS_KEY } from "./shared";
import { recordDiag } from "./diagnostics";
import { extractTabMetadata } from "./metadata";
import { saveItem, resolveProject } from "./collection";
import { pillTitle, showActionFeedback, showTabNotice, showActionError, reportFailure, showPagePills, showSystemNotice, notifyTab } from "./feedback";
import { enqueue as queueItemWrite, commit } from "../storage/coordinator";
import { ICONS } from "../storage/icons";
import { cancelPendingBatch, showPickerOverlay, claimPendingBatch } from "./project-picker";
import { mergeDuplicateMetadata, isIncomplete } from "./duplicate-metadata";

async function quickSave(tab: BackgroundTab, source = "shortcut") {
  tab = unwrapSuspendedTab(tab);
  const en = await usesEnglish();
  if (!tab?.id || !isWebUrl(tab.url)) return { ok: false, error: en ? "The current page can’t be added" : "当前页面无法添加" };
  // 设置里打开了「收藏单篇前先选项目」：跟整窗收藏走同一套流程——
  // 只在当前网页里弹出选项目浮层，用户选好之后再真正开始收藏。
  if (await shouldAskFolderForSingle()) {
    const storedItems = (await chrome.storage.local.get<BackgroundSnapshot>(STORAGE_KEY))[STORAGE_KEY] || [];
    const knownUrls = new Set(storedItems.map((entry) => normalizeUrl(entry.url)));
    const savedCount = knownUrls.has(normalizeUrl(tab.url || "")) ? 1 : 0;
    await recordDiag({
      lastTrigger: source,
      lastStage: "等待选择项目",
      lastStageAt: Date.now(),
      lastRunAt: Date.now(),
      lastTabCount: 1
    });
    return askFolderThenSave({ tabs: [tab], source, activeTab: tab, savedCount });
  }

  // 统一走 extractTabMetadata：它会在抓取前处理抖音「站内切换视频」的滞后问题，
  // 也自带超时兜底（原先直接注入的写法，遇到卡死的页面会一直挂着）。
  const meta = await extractTabMetadata(tab);

  const fallbackUrl = tab.url || "";
  const baseItem = {
    title: meta.title || tab.title || fallbackUrl,
    description: meta.description || "暂无摘要",
    image: meta.image || "",
    favicon: meta.favicon || tab.favIconUrl || "",
    source: meta.source || safeHostname(fallbackUrl),
    url: meta.url || fallbackUrl
  };
  const saved = await saveItem(baseItem);
  // 记一笔封面来源（设置页的「自检」会显示），万一某个站点抓不到封面就知道卡在哪层。
  await recordDiag({
    lastCoverFrom: meta.imageFrom || "none",
    lastTitleFrom: meta.titleFrom || "none",
    lastCoverTitle: String(baseItem.title || "").slice(0, 60),
    lastCoverAt: Date.now()
  });
  const message = saved.refreshed
    ? (en ? `Details updated: ${pillTitle(baseItem.title)}` : `已更新信息：${pillTitle(baseItem.title)}`)
    : saved.duplicated
      ? (en ? "This page is already added" : "这个网页已经添加过了")
      : (en ? `Added: ${pillTitle(baseItem.title)}` : `已添加：${pillTitle(baseItem.title)}`);
  if (tab.suspended) await showActionFeedback("✓", "#25834b", 1600);
  await showTabNotice(tab, message).catch(() => {});
  // 把结果回传，好让侧边栏 / 工具栏小窗口的按钮显示正确的字样。
  return { ok: true, duplicated: !!saved.duplicated, refreshed: !!saved.refreshed, updated: !!saved.updated };
}

// ── 一键收藏所有标签 ────────────────────────────────────────
// 入口：快捷键 Alt+Shift+1 或右键菜单。
// 默认先在当前网页里弹出「选择项目」浮层，选好项目后再真正开始收藏，
// 这样收进来的文章直接归到对应项目，不用事后手动整理。
// 若在设置里关掉了「先选项目」，则直接用上次用过的项目开始收藏。
async function saveAllTabsInWindow(source = "shortcut") {
  // 每一步都记一笔：万一中途卡住或失败，去设置页就能看出停在哪一步。
  const stage = (patch: Parameters<typeof recordDiag>[0]) => recordDiag({ lastTrigger: source, lastStageAt: Date.now(), ...patch });
  let activeTab: BackgroundTab | null | undefined = null;

  try {
    await stage({ lastStage: "开始", lastRunAt: Date.now() });

    const tabs = (await chrome.tabs.query({ currentWindow: true })).map(unwrapSuspendedTab);
    activeTab = tabs.find((tab) => tab.active) || null;
    const targets = tabs.filter((tab) => isWebUrl(tab.url));
    await stage({ lastStage: "读取标签页", lastTabCount: targets.length });

    if (!targets.length) {
      await recordDiag({
        lastStage: "结束（没有可添加的网页）",
        lastAdded: 0,
        lastDuplicated: 0,
        lastEnriched: 0,
        lastDegraded: 0,
        lastError: "当前窗口没有可添加的网页",
        lastErrorAt: Date.now(),
        lastResultAt: Date.now()
      });
      await showActionError();
      return { ok: false, added: 0, duplicated: 0 };
    }

    activeTab = activeTab || targets[0];
    const settings = (await chrome.storage.local.get<BackgroundSnapshot>(SETTINGS_KEY))[SETTINGS_KEY] || {};
    const savedProject = (await chrome.storage.local.get<BackgroundSnapshot>(LAST_PROJECT_KEY))[LAST_PROJECT_KEY] || "";
    // 上次用过的项目可能已经被删掉了：先校验一次，
    // 免得拿一个不存在的 id 去收藏、或在浮层里默认选中一个已经没了的项目。
    const remembered = await resolveProject(savedProject);

    // 这一批里有多少个网页已经收藏过？
    // 用来在浮层里提前说清楚：「已收藏的会被一起搬过来」，免得用户以为重复的会被跳过、
    // 回头还得手动整理一遍。（按网址去重后统计，同一篇在多个标签页里只算一个。）
    const storedItems = (await chrome.storage.local.get<BackgroundSnapshot>(STORAGE_KEY))[STORAGE_KEY] || [];
    const knownUrls = new Set(storedItems.map((entry) => normalizeUrl(entry.url)));
    const batchUrls = new Set(targets.map((tab) => normalizeUrl(tab.url!)));
    let savedCount = 0;
    for (const url of batchUrls) if (knownUrls.has(url)) savedCount += 1;

    // 用户关掉了「先选项目」：直接用上次用过的项目开始。
    if (settings.askFolderOnBatch === false) {
      await stage({ lastStage: "开始添加（未启用项目选择）" });
      return runBatchSave({
        tabs: targets,
        source,
        notifyTabId: activeTab?.id,
        notifySuspended: !!activeTab?.suspended,
        projectId: remembered.id,
        projectName: remembered.name
      });
    }

    await stage({ lastStage: "等待选择项目", lastTabCount: targets.length });
    return askFolderThenSave({ tabs: targets, source, activeTab, savedCount, remembered });
  } catch (error) {
    await recordDiag({
      lastStage: "失败",
      lastError: String(errorMessage(error)),
      lastErrorAt: Date.now()
    }).catch(() => {});
    await reportFailure(error, activeTab);
    return { ok: false, added: 0, duplicated: 0 };
  }
}

// 设置里「收藏单篇前先选项目」有没有打开。
// 默认关：旧设置里没有主动开启标记时直接收进「等待整理」。
async function shouldAskFolderForSingle() {
  const settings = (await chrome.storage.local.get<BackgroundSnapshot>(SETTINGS_KEY))[SETTINGS_KEY] || {};
  return settings.askFolderOnSingle === true && settings.askFolderOnSingleOptIn === true;
}

// 把这一批标签页暂存起来，弹出「选项目」浮层，等用户选好再真正收藏。
// 单篇收藏和整窗收藏共用这一段，所以两条路径的体验完全一致：
// 都是先选项目 → 再抓取收藏 → 已收藏过的会被搬进所选项目。
async function askFolderThenSave({ tabs, source = "shortcut", activeTab = null, savedCount = 0, remembered = null }: { readonly tabs: readonly BackgroundTab[]; readonly source?: string; readonly activeTab?: BackgroundTab | null; readonly savedCount?: number; readonly remembered?: ResolvedProject | null }) {
  const targets = tabs || [];
  const batchId = crypto.randomUUID();
  const last = remembered || (await resolveProject((await chrome.storage.local.get<BackgroundSnapshot>(LAST_PROJECT_KEY))[LAST_PROJECT_KEY] || ""));

  // 先把这一批标签页暂存起来，等用户在浮层里选好项目（或新建一个）再真正开始。
  await queueItemWrite(() => chrome.storage.session.set({
    [PENDING_KEY]: {
      batchId,
      createdAt: Date.now(),
      source,
      notifyTabId: activeTab?.id ?? null,
      notifySuspended: !!activeTab?.suspended,
      projectId: last.id || "",
      savedCount,
      tabs: targets.map((tab) => ({
        id: tab.id,
        url: tab.url,
        title: tab.title || tab.url,
        favIconUrl: tab.favIconUrl || "",
        discarded: !!tab.discarded,
        suspended: !!tab.suspended,
        status: tab.status || "",
        windowId: tab.windowId
      }))
    }
  }));

  // 其他扩展的冻结页不允许注入；在 StaySide 自己的页面复用同一个选择器。
  if (activeTab?.suspended) {
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL(`save-project-picker.html?batch=${encodeURIComponent(batchId)}`) });
      return { ok: true, pending: true, tabCount: targets.length };
    } catch {
      await cancelPendingBatch(batchId);
      const en = await usesEnglish();
      const message = en ? "Couldn’t open the project picker. Try again." : "没能打开项目选择框，请重试";
      await reportFailure(new Error(message), activeTab);
      return { ok: false, pending: false, error: message };
    }
  }
  // 普通网页继续使用页内浮层，不创建独立窗口。
  // 首次注入可能正撞上页面跳转，短暂等一下再重试一次；共享 UI 会先移除旧宿主，
  // 因此即使第一次稍后恢复，页面上最终也只会保留一个浮层。
  const pickerPayload = { tabs: targets.map(tab => ({ ...tab, url: tab.url! })), projectId: last.id ?? undefined, savedCount, batchId };
  let shown = await showPickerOverlay(activeTab, pickerPayload);
  if (!shown && activeTab?.id && isWebUrl(activeTab.url)) {
    await new Promise((resolve) => setTimeout(resolve, 180));
    shown = await showPickerOverlay(activeTab, pickerPayload);
  }
  if (!shown) {
    const en = await usesEnglish();
    const message = isWebUrl(activeTab?.url)
      ? (en ? "Couldn’t open the project picker. Wait for the page to finish loading and try again." : "没能打开项目选择框，请等页面加载完成后再试")
      : (en ? "The project picker can’t open on this page. Switch to a regular web page and try again." : "当前页面不支持网页内选择框，请切到普通网页后再试");
    await recordDiag({
      lastStage: "网页内选择框未打开",
      lastStageAt: Date.now(),
      lastError: message,
      lastErrorAt: Date.now()
    });
    // 能注入提示时沿用收藏通知药丸；连提示也注入不了时才用工具栏角标示警。
    const explained = activeTab?.id && isWebUrl(activeTab.url)
      ? await withTimeout(
          showPagePills(activeTab.id, [{ text: message, kind: "skip" }]).then(() => true),
          900,
          false
        )
      : false;
    if (!explained) await showActionError();
    return { ok: false, pending: false, tabCount: targets.length, error: message };
  }
  return { ok: true, pending: true, tabCount: targets.length };
}

// 真正执行「一篇一篇收藏」。
// 处理方式：**一篇一篇来**（顺序执行），而不是同时开好几个。原因有三：
//  1. 同时抓取多个页面会互相抢资源，有的页面还没渲染完就被读取，封面/摘要就会抓不到；
//  2. 顺序处理可以「完成一篇就立刻通知一篇」，进度马上看得见，感知上快得多；
//  3. 某一篇卡住（未加载完、被冻结）只影响它自己，不会拖住后面的标签。
// 与单篇收藏一样抓取标题 / 摘要 / 封面 / 图标；不抓取正文；已收藏过的网址自动去重。
export async function runBatchSave({ tabs, source = "shortcut", notifyTabId = null, notifySuspended = false, projectId = null, projectName = "" }: BatchOptions) {
  const en = await usesEnglish();
  // 每一步都记一笔：万一中途卡住或失败，去设置页就能看出停在哪一步。
  const stage = (patch: Parameters<typeof recordDiag>[0]) => recordDiag({ lastTrigger: source, lastStageAt: Date.now(), ...patch });
  // 通知统一发到「按下快捷键那一刻的活动标签页」——因为选择项目的小窗口会抢走焦点，
  // 此时「当前活动标签页」已经变成那个弹窗了。
  // 这一批要存进哪个项目（用于提示文案）。
  const folderLabel = projectName || (en ? "Inbox" : "等待整理");
  // 只收一篇时（设置里打开了「收藏单篇前先选项目」）提示从简：
  // 跟以前「一键收藏」一样只弹一条结果，不再多出「开始收藏」「全部完成」两条。
  const single = (tabs || []).length === 1;
  // 原冻结页即使已关闭或选择页抢走焦点，也必须收到结果；整窗只发最终系统通知。
  const notify = (text: string, kind = "", result = single) => {
    if (notifySuspended) return result ? showSystemNotice(text) : Promise.resolve();
    return notifyTab(notifyTabId, text, kind, result);
  };

  try {
    const targets = tabs || [];
    if (!targets.length) {
      await recordDiag({
        lastStage: "结束（没有可添加的网页）",
        lastError: "这一批里没有可添加的网页",
        lastErrorAt: Date.now(),
        lastResultAt: Date.now()
      });
      await showActionError();
      return { ok: false, added: 0, duplicated: 0 };
    }

    // 用上一条新增记录定位插入处，保持标签顺序，同时保留期间的新收藏。
    const base = Date.now();
    let previousAddedId: string | null = null;
    let added = 0;
    let duplicated = 0;
    let movedCount = 0;
    let enriched = 0;
    let degraded = 0;

    // 收多篇时才播报「开始」；收一篇时静悄悄抓，最后只弹一条结果提示。
    if (!single) await notify(en ? `Adding ${targets.length} tabs → ${folderLabel}` : `开始添加 ${targets.length} 个标签页 → ${folderLabel}`);

    for (let i = 0; i < targets.length; i += 1) {
      const tab = targets[i]!;
      await stage({
        lastStage: "逐个添加中",
        lastProgress: `${i + 1}/${targets.length}`,
        lastAdded: added,
        lastDuplicated: duplicated
      });

      // ① 抓取这一篇的标题 / 摘要 / 封面 / 图标（最多等 3 秒）。
      const meta = await extractTabMetadata(tab);

      // 单篇收藏时记一笔封面来源，设置页的「最近一次抓取来源」才不会断更。
      if (single) {
        await recordDiag({
          lastCoverFrom: meta.imageFrom || "none",
          lastTitleFrom: meta.titleFrom || "none",
          lastCoverTitle: String(meta.title || "").slice(0, 60),
          lastCoverAt: Date.now()
        });
      }

      const saved = await queueItemWrite(async () => {
        const stored = await chrome.storage.local.get<BackgroundSnapshot>([STORAGE_KEY, PROJECTS_KEY, ICONS]);
        const items = (stored[STORAGE_KEY] || []).map(entry => ({ ...entry }));
        const targetProjectId = (stored[PROJECTS_KEY] || []).some((project) => project.id === projectId && !project.archived)
          ? projectId : null;
        const key = normalizeUrl(meta.url!);
        const existing = items.find((entry) => normalizeUrl(entry.url) === key);
        if (existing) {
          const refreshed = mergeDuplicateMetadata(existing, meta);
          const target = projectId && !targetProjectId ? existing.projectId || null : targetProjectId;
          const moved = (existing.projectId || null) !== target;
          if (moved) existing.projectId = target;
          await commit(stored, { [STORAGE_KEY]: items });
          return { record: existing, duplicated: true, refreshed, moved };
        }
        const record: BackgroundItem = {
          id: crypto.randomUUID(),
          title: meta.title || meta.url,
          description: meta.description || "暂无摘要",
          image: meta.image || "",
          favicon: meta.favicon || "",
          source: meta.source || safeHostname(meta.url),
          projectId: targetProjectId,
          url: meta.url!,
          savedAt: base - i,
          status: "unread"
        };
        const previousIndex = previousAddedId ? items.findIndex((entry) => entry.id === previousAddedId) : -1;
        items.splice(previousIndex + 1, 0, record);
        await commit(stored, { [STORAGE_KEY]: items });
        return { record, duplicated: false };
      });
      const { record, refreshed, moved } = saved;
      if (saved.duplicated) {
        duplicated += 1;
        if (isIncomplete(record)) degraded += 1;
        if (refreshed || moved) {
          if (refreshed) enriched += 1;
          if (moved) movedCount += 1;
          const title = pillTitle(record.title || meta.title);
          const text = moved
            ? (en
              ? (refreshed ? `Moved to “${folderLabel}” and updated: ${title}` : `Moved to “${folderLabel}”: ${title}`)
              : (refreshed ? `已移到「${folderLabel}」并更新信息：${title}` : `已移到「${folderLabel}」：${title}`))
            : (en ? `Details updated: ${title}` : `已更新信息：${title}`);
          await notify(text, moved ? "move" : "");
        } else {
          await notify(en ? `Already added: ${pillTitle(meta.title)}` : `已添加过：${pillTitle(meta.title)}`, "skip");
        }
        continue;
      }
      previousAddedId = record.id;

      added += 1;
      if (isIncomplete(record)) degraded += 1;
      // ③ 成功一篇就通知一篇，并顺手更新角标数字（切到别的标签页也看得到进度）。
      await showActionFeedback(`+${added}`, "#2f9e44", 2600);
      await notify(en ? `Added: ${pillTitle(record.title)}` : `已添加：${pillTitle(record.title)}`);
    }

    // 收尾：角标停一会儿再清掉，页面上再补一条总结。
    await showActionFeedback(added > 0 ? `+${added}` : "✓", added > 0 ? "#2f9e44" : "#111111", 2600);

    // 收尾总结：把「新收进来的」和「已收藏过、这次搬了家 / 本来就在这儿」的都说清楚。
    const summary = (() => {
      if (added > 0) {
        const parts = [en ? `${added} added` : `新增 ${added} 篇`];
        if (movedCount > 0) parts.push(en ? `${movedCount} existing pages moved to “${folderLabel}”` : `${movedCount} 篇已添加网页移入「${folderLabel}」`);
        const stayed = duplicated - movedCount;
        if (stayed > 0) parts.push(en ? `${stayed} already in “${folderLabel}”` : `${stayed} 篇本来就在「${folderLabel}」`);
        return en ? `Done: ${parts.join(" · ")}` : `全部完成：${parts.join("，")}`;
      }
      if (movedCount > 0) return en ? `Done: moved ${movedCount} existing pages to “${folderLabel}”` : `全部完成：把 ${movedCount} 篇已添加网页移入「${folderLabel}」`;
      if (enriched > 0) return en ? `Done: updated ${enriched} pages` : `全部完成：更新了 ${enriched} 篇的信息`;
      return en ? "All of these pages were already added" : "这些网页都已经添加过了";
    })();
    // 收一篇时结果已经在上面那条提示里说清楚了，不再重复播报总结。
    if (!single) {
      await notify(summary, "", true);
      if (degraded > 0) {
        await notify(en ? `${degraded} saves have no cover or summary` : `有 ${degraded} 篇没有封面或摘要`, "skip");
      }
    }

    await stage({
      lastStage: "完成",
      lastAdded: added,
      lastDuplicated: duplicated,
      lastMoved: movedCount,
      lastEnriched: enriched,
      lastDegraded: degraded,
      lastError: "",
      lastResultAt: Date.now()
    });
    return { ok: true, added, duplicated, moved: movedCount, enriched, degraded };
  } catch (error) {
    // 任何一步抛错都要留下痕迹，避免再次出现「按了没反应、也不知道为什么」。
    await recordDiag({
      lastStage: "失败",
      lastError: String(errorMessage(error)),
      lastErrorAt: Date.now()
    }).catch(() => {});
    await showActionError();
    const message = String(errorMessage(error));
    await notify(en ? `Failed: ${pillTitle(message)}` : `操作失败：${pillTitle(message)}`, "", true);
    return { ok: false, added: 0, duplicated: 0 };
  }
}

// 确认收藏：先回执（好让选项目的小窗口立刻关闭），再在后台继续一篇一篇地收藏。
async function confirmBatchSave(projectId: string | null | undefined, onAccepted: ((response: { readonly ok: true; readonly tabCount: number }) => void) | undefined, batchId?: string) {
  const claimed = await claimPendingBatch(projectId, batchId);
  if (!claimed) return { ok: false, error: (await usesEnglish()) ? "This batch has already been processed" : "这一批标签页已经处理过了" };
  if (typeof onAccepted === "function") onAccepted({ ok: true, tabCount: claimed.tabs.length });
  return runBatchSave(claimed);
}

export { saveAllTabsInWindow, quickSave, confirmBatchSave };
