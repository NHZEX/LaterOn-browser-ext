import { matchesReadFilter, matchesSearch } from "../collection/filter";
import type { ReadFilter, SortMode } from "../collection/filter";
import { resolveImage } from "../collection/item-edit";
import { sortCollectionItems } from "../shared/collection-sort";
import type { ProjectChanges, StoredItem, StoredProject } from "../storage/contracts";
import type { Translate } from "../shared/i18n";
import type { PromptOptions, PromptValues } from "./useLibraryCommands";

export interface LibraryCollection {
  readonly items: readonly StoredItem[];
  readonly projects: readonly StoredProject[];
  readonly covers: Readonly<Record<string, string>>;
}

export type CardOrders = Readonly<Record<string, readonly string[]>>;

// 置顶项目稳定地排在数组最前：存储顺序就是可见顺序，拖动无需再换算下标。
export function pinnedProjects(projects: readonly StoredProject[]): readonly StoredProject[] {
  return [...projects.filter(project => project.pinned), ...projects.filter(project => !project.pinned)];
}

export function libraryProject(id: unknown, projects: readonly StoredProject[]): string {
  return typeof id === "string" && (["all", "archive", "unfiled"].includes(id) || projects.some(project => project.id === id)) ? id : "all";
}

export function typingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);
}

export interface CardScope {
  readonly activeProject: string;
  readonly query: string;
  readonly filter: ReadFilter;
  readonly sort: SortMode;
}

export function collectionCards(collection: LibraryCollection, scope: CardScope, orders: CardOrders): {
  readonly scoped: readonly StoredItem[];
  readonly visible: readonly StoredItem[];
} {
  const archived = new Set(collection.projects.filter(project => project.archived).map(project => project.id));
  // 搜索跨项目，阅读筛选仍生效；归档视图只搜归档，普通范围仍排除其它归档项目。
  const scoped = collection.items.filter(item => {
    if (scope.activeProject === "archive") return archived.has(item.projectId ?? "");
    if (archived.has(item.projectId ?? "") && scope.activeProject !== item.projectId) return false;
    return !!scope.query || scope.activeProject === "all"
      || (scope.activeProject === "unfiled" ? !item.projectId : item.projectId === scope.activeProject);
  });
  const visible = sortCollectionItems(scoped.filter(item => matchesReadFilter(item, scope.filter) && matchesSearch(item, scope.query)), scope.sort, orders[scope.activeProject]);
  return { scoped, visible };
}

export { cardTarget, nextCoverFallback } from "../shared/card-media";

export interface NavigationProject {
  readonly id: string;
  readonly name: string;
  readonly pinned: boolean;
  readonly count: number;
  readonly cover: string;
}

export interface BoardGroup {
  readonly id: string;
  readonly name: string;
  readonly note: string;
  readonly cover: string;
  readonly pick: readonly string[];
  readonly items: readonly StoredItem[];
  readonly own: readonly StoredItem[];
}

// 项目封面优先自定义图，其次所选组合中可用的图，最后取项目内可用封面。
// 项目行缩略图、编辑预览和所属项目浮层共用此规则，保持显示来源一致。
export function projectCoverFor(collection: LibraryCollection, id: string): string {
  const project = collection.projects.find(project => project.id === id);
  if (project?.cover) return project.cover;
  const items = collection.items.filter(item => (item.projectId || "") === id);
  const picked = (project?.coverPick ?? []).map(id => items.find(item => item.id === id));
  return [...picked, ...items].map(item => resolveImage(item, collection.covers)).find(Boolean) ?? "";
}

export function projectEditOptions(collection: LibraryCollection, project: StoredProject, t: Translate): PromptOptions {
  // 预览展示项目实际使用的图；派生封面移除后仍会自动出现，因此 derived 禁用其移除按钮。
  // 组合候选只取项目内有图的收藏，最新优先，最多 48 张；已有选择保留顺序并剔除失效 ID。
  // candidates 启用最多 3 张的组合选择及拖动排序，单篇编辑不传该配置。
  const cover = projectCoverFor(collection, project.id);
  const own = collection.items.filter(item => item.projectId === project.id);
  return { title: t("editProjectTitle", { name: project.name ?? "" }), fields: [
    { name: "name", label: t("projectNameLabel"), value: project.name ?? "", placeholder: t("projectNamePlaceholder"), maxLength: 28 },
    { name: "note", label: t("projectNoteLabel"), value: project.note ?? "", placeholder: t("projectNotePlaceholder"), multiline: true, rows: 3, maxLength: 200 }],
    cover: { name: "cover", label: t("cover"), value: cover, derived: !project.cover, note: t("coverDefaultNote"),
      removedNote: t(project.cover || !cover ? "coverRemoved" : "coverReady"), candidates: [...own].sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
        .filter(item => resolveImage(item, collection.covers)).slice(0, 48).map(item => ({ id: item.id, src: resolveImage(item, collection.covers), title: item.title || item.url || "" })),
      picks: (project.coverPick ?? []).filter(id => own.some(item => item.id === id)), picksName: "coverPick", picksLabel: t("coverPicks"), maxPicks: 3, picksNote: t("coverPicksHint") },
    confirmText: t("save") };
}

export function projectEditChanges(collection: LibraryCollection, original: StoredProject, shownCover: string, values: PromptValues): ProjectChanges {
  // 名称清空仍沿用原名；简介清空则回到自动生成。只提交实际改动，保留并发修改的其它字段。
  const name = typeof values.name === "string" ? values.name.trim() : original.name ?? "";
  const note = typeof values.note === "string" ? values.note.trim() : original.note?.trim() ?? "";
  const cover = typeof values.cover === "string" ? values.cover : shownCover;
  // 缺少 coverPick 表示没有可选封面，维持原选择；空数组表示用户主动清空，回到自动组合。
  const alive = (ids: readonly string[]) => ids.filter(id => collection.items.some(item => item.id === id && item.projectId === original.id));
  const oldPick = alive(original.coverPick ?? []);
  const pick = Array.isArray(values.coverPick) ? alive(values.coverPick) : oldPick;
  // 封面与打开时实际展示的图比较，不能把自动封面顺手固化，否则它不再随项目内容更新。
  return { ...(name && name !== original.name ? { name } : {}), ...(note !== (original.note ?? "").trim() ? { note } : {}),
    ...(cover !== shownCover && cover !== (original.cover ?? "") ? { cover } : {}),
    ...(pick.join(",") !== oldPick.join(",") ? { coverPick: pick } : {}) };
}

export function projectNavigation(collection: LibraryCollection): readonly NavigationProject[] {
  return collection.projects.filter(project => !project.archived).map(project => ({
    id: project.id, name: project.name ?? "", pinned: !!project.pinned,
    count: collection.items.filter(item => item.projectId === project.id).length,
    cover: projectCoverFor(collection, project.id)
  }));
}

// 所属项目浮层与项目导航复用计数、归档过滤和封面规则，另在首行提供等待整理。
export function projectPickerFolders(collection: LibraryCollection, t: Translate): readonly NavigationProject[] {
  return [{ id: "", name: t("inbox"), pinned: false, count: collection.items.filter(item => !item.projectId).length,
    cover: projectCoverFor(collection, "") }, ...projectNavigation(collection)];
}

export function boardGroups(collection: LibraryCollection, filter: ReadFilter, archive: boolean): readonly BoardGroup[] {
  // 图板只列真实项目；未归类收藏留在全部收藏的卡片视图与待整理选择入口中。
  // 保留真正的空项目；普通项目若只是被阅读筛选过滤空则隐藏，归档项目继续显示。
  return collection.projects.filter(project => !!project.archived === archive).map(project => {
    const own = collection.items.filter(item => item.projectId === project.id);
    return { id: project.id, name: project.name ?? "", note: project.note ?? "", cover: project.cover ?? "",
      pick: project.coverPick ?? [], own, items: own.filter(item => matchesReadFilter(item, filter)) };
  }).filter(group => archive || group.items.length > 0 || group.own.length === 0);
}

export function boardCoverItems(group: BoardGroup, covers: LibraryCollection["covers"]): readonly StoredItem[] {
  // 封面、简介和统计使用完整项目 own，不随阅读筛选变化。有效自选封面保留用户顺序；
  // 只有自选全部失效时才自动挑选，优先有图、再按最新排列。
  const picked = group.pick.map(id => group.own.find(item => item.id === id))
    .filter((item): item is StoredItem => !!item && !!resolveImage(item, covers));
  if (picked.length) return picked.slice(0, 3);
  const sorted = [...group.own].sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
  return [...sorted.filter(item => resolveImage(item, covers)), ...sorted.filter(item => !resolveImage(item, covers))].slice(0, 3);
}

export function boardNote(group: BoardGroup, translate: Translate, formatTime: (value: number) => string, english: boolean): { readonly text: string; readonly auto: boolean } {
  const written = group.note.trim();
  if (written) return { text: written, auto: false };
  if (!group.own.length) return { text: translate("emptyBoardNote"), auto: true };
  const counts = new Map<string, number>();
  group.own.forEach(item => {
    const source = item.source?.trim();
    if (source) counts.set(source, (counts.get(source) ?? 0) + 1);
  });
  const sources = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([source]) => source);
  const latest = Math.max(...group.own.map(item => Number(item.savedAt) || 0));
  const parts = [sources.length ? translate("mainlyFrom", { sources: sources.join(english ? ", " : "、") }) : "",
    latest ? translate("updatedAt", { time: formatTime(latest) }) : ""].filter(Boolean);
  return { text: parts.join(" · ") || translate("itemCount", { n: group.own.length }), auto: true };
}

export function boardMeta(group: BoardGroup, translate: Translate, english: boolean): string {
  const count = group.own.length;
  if (!count) return translate("emptyCollection");
  const unread = group.own.filter(item => item.status !== "done").length;
  const suffix = unread ? `${unread} ${translate("notFinished")}` : translate("allRead");
  return `${count} ${english ? "saves" : "篇"} · ${suffix}`;
}

export function formatSavedTime(timestamp: number, now: number, translate: Translate, english: boolean): string {
  const diff = now - timestamp, day = 86400000;
  if (diff < 60000) return translate("justNow");
  if (diff < 3600000) return translate("minutesAgo", { n: Math.floor(diff / 60000) });
  if (diff < day) return translate("hoursAgo", { n: Math.floor(diff / 3600000) });
  if (diff < day * 30) return translate("daysAgo", { n: Math.floor(diff / day) });
  return new Intl.DateTimeFormat(english ? "en" : "zh-CN", { month: "short", day: "numeric" }).format(timestamp);
}

export interface DragRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}
export interface DragLayout {
  readonly ids: readonly string[];
  readonly rects: readonly DragRect[];
}

// 使用开始时的文档坐标快照；滚动与让位动画都不能改变拖放判定的依据。
export function insertionIndex(layout: DragLayout, id: string, slot: number | null, x: number, y: number): number {
  const from = layout.ids.indexOf(id);
  const index = layout.rects.findIndex((rect, index) => index !== from
    && y >= rect.top && y <= rect.bottom && x >= rect.left && x <= rect.right);
  if (index >= 0) {
    const rect = layout.rects[index]!;
    const rest = index < from ? index : index - 1;
    return x >= rect.left + rect.width / 2 ? rest + 1 : rest;
  }
  // 光标进入格子缝隙时维持上个落点，避免反复让开又挤回。
  return slot ?? (layout.rects[0] && y < layout.rects[0].top ? 0 : Math.max(0, layout.ids.length - 1));
}

export function previewOffsets(layout: DragLayout, id: string, slot: number): readonly { readonly x: number; readonly y: number }[] {
  const from = layout.ids.indexOf(id);
  return layout.rects.map((rect, index) => {
    const rest = index < from ? index : index - 1;
    const target = layout.rects[index === from ? slot : rest < slot ? rest : rest + 1] ?? rect;
    return { x: target.left - rect.left, y: target.top - rect.top };
  });
}
