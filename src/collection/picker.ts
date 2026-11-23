import { buildPickerSaveContext, type PickerSaveContext } from "./picker-save-context";

// The web overlay and extension fallback page share the same project list.
export interface PickerProject {
  readonly id: string;
  readonly name: string;
  readonly archived?: boolean;
  readonly cover?: string;
}

export interface PickerItem {
  readonly id: string;
  readonly url?: string;
  readonly projectId?: string | null;
  readonly image?: string;
}

export interface PickerSnapshot {
  readonly laterOnProjects?: readonly PickerProject[];
  readonly laterOnItems?: readonly PickerItem[];
  readonly laterOnSettings?: { readonly language?: string; readonly theme?: string };
  readonly laterOnCovers?: Readonly<Record<string, string>>;
}

export interface PickerRequest {
  readonly projectId?: string;
  readonly batchId?: string;
  readonly savedCount?: number;
  readonly selectedTabs?: boolean;
  readonly tabs?: readonly { readonly url: string; readonly title?: string }[];
}

export interface PickerFolder {
  readonly id: string;
  readonly name: string;
  readonly count: number;
  readonly cover: string | null;
  readonly matchedCount?: number;
}

export interface PickerPage {
  readonly title: string;
  readonly url: string;
  readonly saved?: boolean;
  readonly projectId?: string;
  readonly projectName?: string;
  readonly archived?: boolean;
  readonly missing?: boolean;
}

export interface PickerPayload {
  readonly theme: string;
  readonly language: "en" | "zh-CN";
  readonly selected: string;
  readonly batchId?: string;
  readonly savedCount: number;
  readonly titleText?: string;
  readonly saveContext?: PickerSaveContext;
  readonly folders: readonly PickerFolder[];
  readonly pages: readonly PickerPage[];
}

export type { PickerSaveContext, PickerSaveGroup } from "./picker-save-context";

/** Build UI data from the current collection and a fixed batch snapshot. */
export function buildPayload(stored: PickerSnapshot, payload: PickerRequest): PickerPayload {
  const projects = stored.laterOnProjects || [];
  const items = stored.laterOnItems || [];
  const settings = stored.laterOnSettings || {};
  const covers = stored.laterOnCovers || {};
  const english = settings.language === "en";
  const counts = new Map<string, number>();
  items.forEach((item) => {
    const id = item.projectId || "";
    counts.set(id, (counts.get(id) || 0) + 1);
  });
  const coverFor = (projectId: string): string | null => {
    const custom = projects.find((project) => project.id === projectId)?.cover;
    if (custom) return custom;
    for (const item of items.filter((entry) => (entry.projectId || "") === projectId)) {
      const itemCover = covers[item.id];
      if (itemCover) return itemCover;
      const image = typeof item.image === "string" ? item.image : "";
      if (image.startsWith("local://")) {
        const linkedCover = covers[image.slice(8)];
        if (linkedCover) return linkedCover;
      } else if (image) return image;
    }
    return null;
  };
  const folder = (id: string, name: string): PickerFolder => ({
    id, name, count: counts.get(id) || 0, cover: coverFor(id)
  });
  const context = buildPickerSaveContext(payload.tabs, items, projects, english);
  const folders = [
    folder("", english ? "Inbox" : "等待整理"),
    ...projects.filter((project) => !project.archived).map((project) => folder(project.id, project.name))
  ].map((entry) => ({ ...entry, matchedCount: context.matchedCounts.get(entry.id) || 0 }));

  let selected = folders.find((entry) => entry.id === payload.projectId)?.id || "";
  if (context.saveContext.sameProjectId !== null &&
    folders.some((entry) => entry.id === context.saveContext.sameProjectId)) {
    selected = context.saveContext.sameProjectId;
  }
  if (selected && !folders.some((entry) => entry.id === selected)) selected = "";

  return {
    theme: settings.theme || "light",
    language: english ? "en" : "zh-CN",
    selected,
    batchId: payload.batchId,
    savedCount: payload.tabs ? context.saveContext.savedCount : (payload.savedCount || 0),
    ...(payload.selectedTabs && payload.tabs?.length ? { titleText: english
      ? `Add ${payload.tabs.length} selected ${payload.tabs.length === 1 ? "tab" : "tabs"} to which project?`
      : `将选中的 ${payload.tabs.length} 个标签页添加到哪个项目？` } : {}),
    ...(payload.tabs ? { saveContext: context.saveContext } : {}),
    folders,
    pages: payload.tabs ? context.pages : []
  };
}
