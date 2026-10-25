import type { LibraryCollection } from "./shared";
import type { Translate } from "../shared/i18n";

export type LibraryMenuAction = "pin" | "rename" | "edit" | "archive" | "delete" | "open" | "select";
export type MenuIcon = "pin" | "unpin" | "pencil" | "archive" | "trash" | "open" | "multi" | "deselect" | "note";
export interface LibraryMenuTarget {
  readonly kind: "project" | "item";
  readonly id: string;
}
export interface LibraryMenuRequest extends LibraryMenuTarget {
  readonly x: number;
  readonly y: number;
  readonly trigger: HTMLElement | null;
}
export interface LibraryMenuEntry {
  readonly action: LibraryMenuAction;
  readonly label: string;
  readonly icon: MenuIcon;
  readonly danger?: boolean;
}
export interface LibraryMenuContent {
  readonly title: string;
  readonly heading: string;
  readonly entries: readonly LibraryMenuEntry[];
}

export function libraryMenuContent(collection: LibraryCollection, target: LibraryMenuTarget, selected: ReadonlySet<string>,
  selecting: boolean, translate: Translate): LibraryMenuContent | null {
  if (target.kind === "project") {
    const project = collection.projects.find(project => project.id === target.id);
    if (!project) return null;
    const title = project.name ?? "";
    // 置顶是常用且可逆的操作，放在首项；误操作可直接取消置顶。
    return { title, heading: title, entries: [
      { action: "pin", label: translate(project.pinned ? "unpinProject" : "pinProject"), icon: project.pinned ? "unpin" : "pin" },
      { action: "rename", label: translate("rename"), icon: "pencil" },
      { action: "edit", label: translate("editNote"), icon: "note" },
      { action: "archive", label: translate(project.archived ? "restoreProject" : "archiveProject"), icon: "archive" },
      { action: "delete", label: translate("deleteProject"), icon: "trash", danger: true }
    ] };
  }
  const item = collection.items.find(item => item.id === target.id);
  if (!item) return null;
  const title = item.title?.trim() || item.source || translate("itemFallback");
  const picked = selecting && selected.has(item.id);
  // 右键菜单补充卡片不便操作的入口；阅读状态和移动项目已有卡片控件，不再重复。
  return { title, heading: title.length > 20 ? `${title.slice(0, 20)}…` : title, entries: [
    { action: "open", label: translate("itemOpen"), icon: "open" },
    { action: "edit", label: translate("itemEdit"), icon: "pencil" },
    { action: "select", label: translate(picked ? "itemDeselect" : "itemSelect"), icon: picked ? "deselect" : "multi" },
    { action: "delete", label: translate("delete"), icon: "trash", danger: true }
  ] };
}

export function menuPosition(x: number, y: number, width: number, height: number, viewportWidth: number, viewportHeight: number): {
  readonly left: number; readonly top: number;
} {
  return {
    left: Math.min(Math.max(8, x - width), Math.max(8, viewportWidth - width - 8)),
    top: Math.min(Math.max(8, y), Math.max(8, viewportHeight - height - 8))
  };
}
