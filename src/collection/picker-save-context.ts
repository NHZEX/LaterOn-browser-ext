import { normalize } from "../shared/url-utils";

export interface SaveContextProject {
  readonly id: string;
  readonly name?: string;
  readonly archived?: boolean;
}

export interface SaveContextItem {
  readonly id?: string;
  readonly url?: string;
  readonly projectId?: string | null;
}

export interface SaveContextTab {
  readonly url: string;
  readonly title?: string;
}

export interface PickerSaveGroup {
  readonly projectId: string;
  readonly projectName: string;
  readonly count: number;
  readonly archived?: boolean;
  readonly missing?: boolean;
}

export interface PickerSaveContext {
  readonly total: number;
  readonly savedCount: number;
  readonly newCount: number;
  readonly groups: readonly PickerSaveGroup[];
  readonly sameProjectId: string | null;
}

export interface PickerSavePage {
  readonly title: string;
  readonly url: string;
  readonly saved?: boolean;
  readonly projectId?: string;
  readonly projectName?: string;
  readonly archived?: boolean;
  readonly missing?: boolean;
}

export interface PickerSaveContextResult {
  readonly saveContext: PickerSaveContext;
  readonly pages: readonly PickerSavePage[];
  readonly matchedCounts: ReadonlyMap<string, number>;
}

/** Read-only membership snapshot for the project picker; does not write storage. */
export function buildPickerSaveContext(
  tabs: readonly SaveContextTab[] | undefined,
  items: readonly SaveContextItem[] | undefined,
  projects: readonly SaveContextProject[] | undefined,
  english = false
): PickerSaveContextResult {
  const targets = Array.isArray(tabs) ? tabs : [];
  const wanted = new Set(targets.map((tab) => normalize(tab.url || "")).filter(Boolean));
  const saved = new Map<string, SaveContextItem>();
  for (const item of Array.isArray(items) ? items : []) {
    const url = normalize(item?.url || "");
    if (wanted.has(url) && !saved.has(url)) saved.set(url, item);
  }
  const byProject = new Map((Array.isArray(projects) ? projects : []).map((project) => [String(project.id), project]));
  const where = (item: SaveContextItem) => {
    const projectId = item?.projectId ? String(item.projectId) : "";
    const project = byProject.get(projectId);
    const name = !projectId
      ? (english ? "Inbox" : "等待整理")
      : project
        ? project.name || (english ? "Untitled project" : "未命名项目")
        : (english ? "Deleted project" : "已删除的项目");
    return {
      projectId,
      projectName: project?.archived ? `${name}${english ? " (archived)" : "（已归档）"}` : name,
      ...(project?.archived ? { archived: true as const } : {}),
      ...(!project && projectId ? { missing: true as const } : {})
    };
  };
  const groups = new Map<string, PickerSaveGroup & { count: number }>();
  for (const url of wanted) {
    const item = saved.get(url);
    if (!item) continue;
    const location = where(item);
    const existing = groups.get(location.projectId);
    if (existing) existing.count += 1;
    else groups.set(location.projectId, { ...location, count: 1 });
  }
  const allGroups = [...groups.values()];
  const total = wanted.size;
  const savedCount = saved.size;
  const common = total > 0 && total === savedCount && allGroups.length === 1 ? allGroups[0]!.projectId : null;
  return {
    saveContext: { total, savedCount, newCount: total - savedCount, groups: allGroups, sameProjectId: common },
    pages: targets.map((tab) => {
      const item = saved.get(normalize(tab.url || ""));
      return { title: tab.title || tab.url, url: tab.url, saved: !!item, ...(item ? where(item) : {}) };
    }),
    matchedCounts: new Map(allGroups.map((group) => [group.projectId, group.count]))
  };
}
