import { resolveImage } from "../collection/item-edit";
import { normalize as normalizeUrl } from "../shared/url-utils";
import type { StoredItem } from "../storage/contracts";
import { isRecord } from "../storage/contracts";
import { SYNC_ACCEPTANCE_BUILD, SYNC_META } from "./acceptance";
import type { SyncMeta } from "./binding";

export type SyncViewSnapshot = { readonly [SYNC_META]?: Pick<SyncMeta, "binding"> };
export type MemberGroups = ReadonlyMap<string, readonly StoredItem[]>;
export const hasSyncBinding = (meta: unknown) => SYNC_ACCEPTANCE_BUILD && isRecord(meta) && isRecord(meta.binding);
export const syncViewBound = (snapshot: SyncViewSnapshot) => hasSyncBinding(snapshot[SYNC_META]);

function compareMembers(left: StoredItem, right: StoredItem): number {
  return (left.savedAt ?? 0) - (right.savedAt ?? 0) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

export function groupMembers(items: readonly StoredItem[]): MemberGroups {
  const byUrl = new Map<string, StoredItem[]>();
  const byId = new Map<string, readonly StoredItem[]>();
  for (const item of items) {
    const url = item.url ? normalizeUrl(item.url) : "";
    if (!url) { byId.set(item.id, [item]); continue; }
    const members = byUrl.get(url);
    if (members) members.push(item);
    else byUrl.set(url, [item]);
  }
  for (const members of byUrl.values()) {
    members.sort(compareMembers);
    for (const member of members) byId.set(member.id, members);
  }
  return byId;
}

export function projectCards(scoped: readonly StoredItem[], groups?: MemberGroups): readonly StoredItem[] {
  if (!groups) return scoped;
  const cards = new Map<string, StoredItem>();
  for (const item of scoped) {
    const canonical = groups.get(item.id)?.[0] ?? item;
    cards.set(canonical.id, canonical);
  }
  return [...cards.values()];
}

export function groupCover(item: StoredItem, covers: Readonly<Record<string, string>>, groups?: MemberGroups) {
  const members = groups?.get(item.id) ?? [item];
  const sources = members.map(member => ({ id: member.id, source: resolveImage(member, covers),
    manual: member.imageEdited === true || member.image?.startsWith("local://") || member.image?.startsWith("data:") }));
  return sources.find(cover => cover.manual && cover.source) ?? sources.find(cover => cover.source) ?? { id: item.id, source: "" };
}

export function groupOrderOwner(id: string, order: ReadonlySet<string>, groups?: MemberGroups, inScope = (_item: StoredItem) => true): string {
  const members = groups?.get(id)?.filter(inScope);
  return members?.find(member => order.has(member.id))?.id ?? members?.[0]?.id ?? id;
}

export function projectOrder(order: readonly string[] | undefined, groups?: MemberGroups): readonly string[] | undefined {
  if (!order || !groups) return order;
  const slots = new Set(order);
  return order.flatMap(id => {
    const canonical = groups.get(id)?.[0];
    return canonical && groupOrderOwner(id, slots, groups) === id ? [canonical.id] : [];
  });
}
