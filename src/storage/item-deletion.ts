import type { SyncMeta } from "../sync/binding";
import { mergeSyncStates } from "../sync/state";
import { COVERS, CURRENT, ITEMS, ORDER, POSITIONS, PROJECTS } from "./contracts";
import type { CollectionState, StoredItem, StoredProject } from "./contracts";

export function pruneProjectPicks(projects: readonly StoredProject[], items: readonly StoredItem[]): StoredProject[] {
  return projects.map(project => {
    if (!Array.isArray(project.coverPick)) return project;
    const alive = new Set(items.filter(item => item.projectId === project.id).map(item => item.id));
    const picks = project.coverPick.filter(id => alive.has(id));
    if (picks.length && picks.length === project.coverPick.length) return project;
    const { coverPick, ...fields } = project;
    return picks.length ? { ...fields, coverPick: picks } : fields;
  });
}

export function itemRemovalPatch(stored: CollectionState, items: readonly StoredItem[], removed: ReadonlySet<string>): CollectionState {
  const retained = <Value>(record?: Readonly<Record<string, Value>>) =>
    Object.fromEntries(Object.entries(record ?? {}).filter(([id]) => !removed.has(id)));
  const projects = stored[PROJECTS] ?? [];
  const remaining = pruneProjectPicks(projects, items);
  return { [ITEMS]: items, [COVERS]: retained(stored[COVERS]), [POSITIONS]: retained(stored[POSITIONS]),
    [ORDER]: Object.fromEntries(Object.entries(stored[ORDER] ?? {}).map(([scope, ids]) => [scope, ids.filter(id => !removed.has(id))])),
    ...(stored[CURRENT] != null && removed.has(stored[CURRENT]) ? { [CURRENT]: null } : {}),
    ...(remaining.some((project, index) => project !== projects[index]) ? { [PROJECTS]: remaining } : {}) };
}

export function recordSyncDeletions(meta: SyncMeta | undefined, removed: ReadonlySet<string>): SyncMeta | undefined {
  if (!meta?.binding || !removed.size) return;
  const state = mergeSyncStates(meta.binding.state ?? { members: [], deletedIds: [] }, { members: [], deletedIds: [...removed] });
  return { ...meta, binding: { ...meta.binding, state } };
}
