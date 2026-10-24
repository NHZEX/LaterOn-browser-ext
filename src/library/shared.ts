import { matchesReadFilter } from "../collection/filter";
import type { ReadFilter } from "../collection/filter";
import { resolveImage } from "../collection/item-edit";
import type { StoredItem, StoredProject } from "../storage/contracts";
import type { Translate } from "../shared/i18n";

export interface LibraryCollection {
  readonly items: readonly StoredItem[];
  readonly projects: readonly StoredProject[];
  readonly covers: Readonly<Record<string, string>>;
}

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

export function projectCoverFor(collection: LibraryCollection, id: string): string {
  const project = collection.projects.find(project => project.id === id);
  if (project?.cover) return project.cover;
  const items = collection.items.filter(item => (item.projectId || "") === id);
  const picked = (project?.coverPick ?? []).map(id => items.find(item => item.id === id));
  return [...picked, ...items].map(item => resolveImage(item, collection.covers)).find(Boolean) ?? "";
}

export function projectNavigation(collection: LibraryCollection): readonly NavigationProject[] {
  return collection.projects.filter(project => !project.archived).map(project => ({
    id: project.id, name: project.name ?? "", pinned: !!project.pinned,
    count: collection.items.filter(item => item.projectId === project.id).length,
    cover: projectCoverFor(collection, project.id)
  }));
}

export function boardGroups(collection: LibraryCollection, filter: ReadFilter, archive: boolean): readonly BoardGroup[] {
  return collection.projects.filter(project => !!project.archived === archive).map(project => {
    const own = collection.items.filter(item => item.projectId === project.id);
    return { id: project.id, name: project.name ?? "", note: project.note ?? "", cover: project.cover ?? "",
      pick: project.coverPick ?? [], own, items: own.filter(item => matchesReadFilter(item, filter)) };
  }).filter(group => archive || group.items.length > 0 || group.own.length === 0);
}

export function boardCoverItems(group: BoardGroup, covers: LibraryCollection["covers"]): readonly StoredItem[] {
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

export function nextCoverFallback(currentSrc: string): string {
  let url: URL;
  try { url = new URL(currentSrc); } catch { return ""; }
  const matched = /^\/vi\/([^/]+)\/([^/]+\.jpg)$/.exec(url.pathname);
  if (!matched || url.hostname !== "i.ytimg.com") return "";
  const chain = ["maxresdefault.jpg", "hq720.jpg", "hqdefault.jpg", "mqdefault.jpg"];
  const index = chain.indexOf(matched[2] ?? "");
  const next = index >= 0 ? chain[index + 1] : undefined;
  if (!next) return "";
  url.pathname = `/vi/${matched[1]}/${next}`;
  url.search = "";
  return url.href;
}
