import { ref, shallowRef, watch } from "vue";
import type { Ref } from "vue";
import type { CollectionSuccess, ItemChanges, StoredItem } from "../storage/contracts";
import type { Translate } from "../shared/i18n";
import { cardTarget } from "./shared";
import type { LibraryCollection } from "./shared";
import type { LibrarySelection } from "./useLibrarySelection";

interface PickerRequest {
  readonly anchor: HTMLElement;
  readonly selected: string;
  readonly titleText: string;
  readonly current: () => boolean;
  readonly onPick: (id: string, name: string) => Promise<{ readonly ok: boolean; readonly error?: string }>;
}
interface BulkEffects {
  readonly translate: Translate;
  readonly toast: (message: string) => void;
  readonly mutate: (operation: "update" | "delete", ids: readonly string[], patch?: ItemChanges) => Promise<CollectionSuccess | null>;
  readonly confirm: (config: { tone: "danger"; title: string; message: string; confirmText: string }) => Promise<boolean>;
  readonly pick: (request: PickerRequest) => { readonly close: () => void };
  readonly openWindow: (urls: readonly string[]) => Promise<{ readonly id?: number } | null | undefined>;
}

export function useLibraryBulk(selection: LibrarySelection, collection: Readonly<Ref<LibraryCollection>>,
  visible: Readonly<Ref<readonly StoredItem[]>>) {
  const effects = shallowRef<BulkEffects | null>(null);
  const pending = ref(false);
  let picker: { readonly close: () => void } | undefined;
  function closePicker(): void { picker?.close(); picker = undefined; }
  function bind(next: BulkEffects): void { effects.value = next; }
  function snapshot() {
    const boundary = effects.value;
    if (!boundary || pending.value || !selection.ids.value.size) return null;
    const session = selection.session.value;
    return { boundary, ids: [...selection.ids.value], current: () => effects.value === boundary && selection.session.value === session };
  }
  async function update(patch: ItemChanges): Promise<void> {
    const batch = snapshot(); if (!batch) return;
    pending.value = true;
    try { if (await batch.boundary.mutate("update", batch.ids, patch) && batch.current()) selection.complete(batch.ids); }
    catch { if (batch.current()) batch.boundary.toast(batch.boundary.translate("operationFailed")); }
    finally { pending.value = false; }
  }
  async function remove(): Promise<void> {
    const batch = snapshot(); if (!batch) return;
    const { translate: t, confirm, toast } = batch.boundary;
    pending.value = true;
    try {
      const confirmed = await confirm({ tone: "danger", title: t("bulkDeleteTitle", { n: batch.ids.length }),
        message: t("cannotUndo"), confirmText: t("bulkDeleteButton", { n: batch.ids.length }) });
      if (!confirmed || !batch.current()) return;
      const result = await batch.boundary.mutate("delete", batch.ids);
      if (result && batch.current()) { toast(t("bulkDeleted", { n: result.affected ?? 0 })); selection.complete(batch.ids); }
    } catch { if (batch.current()) toast(t("operationFailed")); }
    finally { pending.value = false; }
  }
  function move(anchor: HTMLElement): void {
    const batch = snapshot(); if (!batch) return;
    const { translate: t, pick, toast } = batch.boundary;
    const projects = new Set(collection.value.items.filter(item => selection.ids.value.has(item.id)).map(item => item.projectId || ""));
    closePicker();
    picker = pick({ anchor, current: batch.current, selected: projects.size === 1 ? [...projects][0] ?? "" : "", titleText: t("bulkMoveTitle", { n: batch.ids.length }),
      onPick: async (id, name) => {
        if (pending.value || !batch.current()) return { ok: false, error: t("operationFailed") };
        pending.value = true;
        try {
          const result = await batch.boundary.mutate("update", batch.ids, { projectId: id || null });
          if (!result) return { ok: false, error: t("operationFailed") };
          if (batch.current()) { toast(t("bulkMoved", { n: result.affected ?? 0, name: name || t("inbox") })); selection.complete(batch.ids); }
          return { ok: true };
        } catch { return { ok: false, error: t("operationFailed") }; }
        finally { pending.value = false; }
      } });
  }
  async function open(): Promise<void> {
    const batch = snapshot(); if (!batch) return;
    const { translate: t, toast, openWindow } = batch.boundary;
    const visibleIds = new Set(visible.value.map(item => item.id));
    const ordered = [...visible.value, ...collection.value.items.filter(item => !visibleIds.has(item.id))];
    const ids = new Set(batch.ids);
    const urls = ordered.filter(item => ids.has(item.id)).map(item => cardTarget(item.url)).filter(Boolean);
    if (!urls.length) { toast(t("noValidPages")); return; }
    pending.value = true;
    toast(t("openingNewWindow", { n: urls.length }));
    try {
      const created = await openWindow(urls);
      if (created?.id == null) throw new Error("No window was created");
      if (batch.current()) { selection.complete(batch.ids); toast(t("openedNewWindow", { n: urls.length })); }
    } catch { if (batch.current()) toast(t("newWindowOpenFailed")); }
    finally { pending.value = false; }
  }
  const stopSession = watch(selection.session, closePicker, { flush: "sync" });
  function dispose(): void { effects.value = null; stopSession(); closePicker(); }
  return { pending, bind, update, remove, move, open, dispose };
}
