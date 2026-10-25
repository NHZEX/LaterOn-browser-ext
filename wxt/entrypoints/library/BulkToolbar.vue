<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, watch } from "vue";
import type { LibraryControls } from "../../../src/library/useLibraryControls";
import type { Translate } from "../../../src/shared/i18n";

const props = defineProps<{ controls: LibraryControls; translate: Translate }>();
const root = shallowRef<HTMLElement | null>(null);
function done(): void { props.controls.selection.set(false); }
function all(): void { props.controls.selection.all(); }
function read(): void { void props.controls.bulk.update({ status: "done" }); }
function unread(): void { void props.controls.bulk.update({ status: "unread" }); }
function open(): void { void props.controls.bulk.open(); }
function remove(): void { void props.controls.bulk.remove(); }
function move(event: MouseEvent): void { if (event.currentTarget instanceof HTMLElement) props.controls.bulk.move(event.currentTarget); }
function outside(event: PointerEvent): void {
  if (!props.controls.state.selecting || !(event.target instanceof Element)) return;
  // 卡片、操作栏和浮层内交互不退出多选；Shadow DOM 会把弹窗点击重定向到 .lod-root 宿主。
  if (event.target.closest(".card, .folder-menu, #bulkBar, #selectMode, #lateron-folder-picker, .lod-root")) return;
  done();
}
function escape(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.key !== "Escape" || props.controls.menu.value || props.controls.state.renamingId) return;
  done();
}
function restoreFocus(selecting: boolean): void {
  if (!selecting && root.value?.contains(document.activeElement)) {
    document.querySelector<HTMLElement>(props.controls.state.board ? "#homeBrand" : "#selectMode")?.focus({ preventScroll: true });
  }
}
function preservePendingFocus(pending: boolean): void {
  if (pending && root.value?.contains(document.activeElement)) {
    root.value.querySelector<HTMLButtonElement>("#bulkDone")?.focus({ preventScroll: true });
  }
}
watch(() => props.controls.state.selecting, restoreFocus, { flush: "sync" });
watch(props.controls.bulk.pending, preservePendingFocus, { flush: "sync" });
onMounted(() => {
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("keydown", escape);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", outside, true);
  document.removeEventListener("keydown", escape);
});
</script>

<template>
  <div id="bulkBar" ref="root" class="bulk-bar" :class="{ 'is-open': controls.state.selecting }" :inert="!controls.state.selecting || undefined"
    :aria-hidden="!controls.state.selecting" :aria-busy="controls.bulk.pending.value">
    <span id="bulkCount" class="bulk-count" role="status" aria-live="polite" aria-atomic="true">{{ translate('selectCount', { count: controls.selectedIds.value.size }) }}</span>
    <div class="bulk-actions">
      <button id="bulkSelectAll" type="button" :disabled="controls.bulk.pending.value || !controls.cards.value.length" @click="all">{{ translate(controls.selection.allSelected.value ? 'deselectAll' : 'selectAll') }}</button>
      <button id="bulkRead" type="button" :disabled="controls.bulk.pending.value || !controls.selectedIds.value.size" @click="read">{{ translate('markDone') }}</button>
      <button id="bulkUnread" type="button" :disabled="controls.bulk.pending.value || !controls.selectedIds.value.size" @click="unread">{{ translate('markUnread') }}</button>
      <button id="bulkOpenWindow" type="button" :disabled="controls.bulk.pending.value || !controls.selectedIds.value.size" @click="open">{{ translate('openInNewWindow') }}</button>
      <button id="bulkProject" class="bulk-project" type="button" :aria-label="translate('moveTo')" aria-haspopup="dialog"
        :disabled="controls.bulk.pending.value || !controls.selectedIds.value.size" @click="move">
        <span>{{ translate('moveTo') }}</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      <button id="bulkDelete" type="button" class="danger" :disabled="controls.bulk.pending.value || !controls.selectedIds.value.size" @click="remove">{{ translate('delete') }}</button>
      <button id="bulkDone" type="button" class="primary" @click="done">{{ translate('done') }}</button>
    </div>
  </div>
</template>
