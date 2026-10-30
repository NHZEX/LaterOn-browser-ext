import type { ResolvedProject, SaveInput, BackgroundItem } from "./shared";
import type { BackgroundSnapshot } from "./shared";
import { PROJECTS_KEY, STORAGE_KEY, safeHostname } from "./shared";
import { enqueue as queueItemWrite, commit } from "../storage/coordinator";
import { ICONS } from "../storage/icons";
import { normalize as normalizeUrl } from "../shared/url-utils";
import { mergeDuplicateMetadata } from "./duplicate-metadata";
import { showActionFeedback } from "./feedback";

// 校验一个项目 id 是否还存在，并取出它的名字。
// 用途：用户可能在浮层开着的时候把项目删了，或上次用过的项目早已被删，
// 这时要退回「待整理」，否则收藏会带上一个指向不存在项目的归属。
async function resolveProject(projectId?: string | null): Promise<ResolvedProject> {
  if (!projectId) return { id: null, name: "等待整理" };
  const projects = (await chrome.storage.local.get<BackgroundSnapshot>(PROJECTS_KEY))[PROJECTS_KEY] || [];
  const matched = projects.find((project) => project.id === projectId && !project.archived);
  return matched ? { id: matched.id, name: matched.name } : { id: null, name: "等待整理" };
}

async function saveItem(item: SaveInput, options: { readonly silent?: boolean } = {}) {
  const saved = await queueItemWrite(async () => {
    const result = await chrome.storage.local.get<BackgroundSnapshot>([STORAGE_KEY, ICONS]);
    const items = (result[STORAGE_KEY] || []).map(entry => ({ ...entry }));
    const normalizedUrl = normalizeUrl(item.url);
    const index = items.findIndex((entry) => normalizeUrl(entry.url) === normalizedUrl);

    // 已存在相同网址：视为重复收藏——不新建、不挪动顺序；
    // 但会把「缺的 / 明显过期的」信息补上（YouTube 一律刷新，见 mergeDuplicateMetadata）。
    if (index >= 0) {
      const existing = items[index]!;
      const refreshed = mergeDuplicateMetadata(existing, item);
      const written = await commit(result, { [STORAGE_KEY]: items });
      return { ok: true, item: (written[STORAGE_KEY] || items).find(entry => entry.id === existing.id)!,
        icons: written[ICONS] || result[ICONS] || {}, updated: true, duplicated: true, refreshed };
    }

    const normalized: BackgroundItem = {
      id: crypto.randomUUID(),
      title: item.title || item.url,
      description: item.description || "暂无摘要",
      image: item.image || "",
      favicon: item.favicon || "",
      source: item.source || safeHostname(item.url),
      projectId: null,
      url: item.url,
      savedAt: Date.now(),
      status: "unread"
    };
    items.unshift(normalized);
    const written = await commit(result, { [STORAGE_KEY]: items });

    return { ok: true, item: (written[STORAGE_KEY] || items).find(entry => entry.id === normalized.id)!,
      icons: written[ICONS] || result[ICONS] || {}, updated: false, duplicated: false };
  });
  if (!options.silent && !saved.duplicated) {
    await showActionFeedback("✓", "#111111", 1600);
  }
  return saved;
}

export { saveItem, resolveProject };
