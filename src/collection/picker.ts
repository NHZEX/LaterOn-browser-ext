// The web overlay and extension fallback page share the same project list.
export interface PickerProject {
  readonly id: string;
  readonly name: string;
  readonly archived?: boolean;
  readonly cover?: string;
}

export interface PickerItem {
  readonly id: string;
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
  readonly tabs?: readonly { readonly url: string; readonly title?: string }[];
}

export interface PickerFolder {
  readonly id: string;
  readonly name: string;
  readonly count: number;
  readonly cover: string | null;
}

export interface PickerPayload {
  readonly theme: string;
  readonly language: "en" | "zh-CN";
  readonly selected: string;
  readonly batchId?: string;
  readonly savedCount: number;
  readonly folders: readonly PickerFolder[];
  readonly pages: readonly { readonly title: string; readonly url: string }[];
}

/** Build UI data from the current collection and a fixed batch snapshot. */
export function buildPayload(stored: PickerSnapshot, payload: PickerRequest): PickerPayload {
  const projects = stored.laterOnProjects || [];
  const items = stored.laterOnItems || [];
  const settings = stored.laterOnSettings || {};
  const covers = stored.laterOnCovers || {};
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
  const folders = [
    folder("", settings.language === "en" ? "Inbox" : "等待整理"),
    ...projects.filter((project) => !project.archived).map((project) => folder(project.id, project.name))
  ];
  return {
    theme: settings.theme || "light",
    language: settings.language === "en" ? "en" : "zh-CN",
    selected: folders.find((entry) => entry.id === payload.projectId)?.id || "",
    batchId: payload.batchId,
    savedCount: payload.savedCount || 0,
    folders,
    pages: (payload.tabs || []).map((entry) => ({ title: entry.title || entry.url, url: entry.url }))
  };
}
