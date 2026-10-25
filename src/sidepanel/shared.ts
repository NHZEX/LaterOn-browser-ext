import { matchesReadFilter, matchesSearch, normalizeSort, type ReadFilter } from "../collection/filter";
import { sortCollectionItems } from "../shared/collection-sort";
import type { StoredItem, StoredProject } from "../storage/contracts";
import type { Translate } from "../shared/i18n";

export function panelSavedTime(timestamp: number | undefined, language: string, t: Translate, now = Date.now()): string {
  const days = Math.floor((now - (timestamp ?? now)) / 86400000);
  if (days < 1) return t("today");
  if (days < 30) return t("daysAgo", { n: days });
  return new Intl.DateTimeFormat(language === "en" ? "en" : "zh-CN", { month: "short", day: "numeric" }).format(timestamp);
}

export interface PanelCollection {
  readonly items: readonly StoredItem[];
  readonly projects: readonly StoredProject[];
  readonly archivedProjectIds: ReadonlySet<string>;
  readonly orders: Readonly<Record<string, readonly string[]>>;
  readonly sortMode: string;
}
export interface PanelScope { filter: ReadFilter; query: string; project: string }

// 「全部项目」只属于全屏图板总览；侧栏收到 all 或失效项目时回到「等待整理」。
export function normalizePanelProject(value: unknown, projects: readonly StoredProject[]): string {
  return projects.some(project => project.id === value && !project.archived) ? String(value) : "unfiled";
}

export function visiblePanelItems(collection: PanelCollection, scope: PanelScope): readonly StoredItem[] {
  // 搜索跨项目，避免在当前目录里找不到已收藏的网页；用户选择的阅读筛选仍然生效。
  const visible = collection.items.filter(item => !collection.archivedProjectIds.has(item.projectId ?? "")
    && (!!scope.query || (scope.project === "unfiled" ? !item.projectId : item.projectId === scope.project))
    && matchesReadFilter(item, scope.filter) && matchesSearch(item, scope.query));
  return sortCollectionItems(visible, normalizeSort(collection.sortMode), collection.orders[scope.project]);
}

export function panelProjects(collection: PanelCollection): readonly { id: string; name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of collection.items) {
    const id = item.projectId || "unfiled";
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const count = (id: string): number => counts.get(id) ?? 0;
  // 侧栏只保留「等待整理 + 具体项目」，不承担全库总览；计数不受搜索或阅读筛选影响。
  return [{ id: "unfiled", name: "", count: count("unfiled") },
    ...collection.projects.filter(project => !project.archived).map(project => ({ id: project.id, name: project.name ?? "", count: count(project.id) }))];
}
