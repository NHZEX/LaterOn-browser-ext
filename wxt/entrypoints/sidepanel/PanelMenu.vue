<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { menuPosition } from "../../../src/library/menu";
import { cardTarget } from "../../../src/shared/card-media";
import type { PanelActions, PanelMenuAction, PanelMenuRequest } from "../../../src/sidepanel/usePanelActions";
import type { SidepanelControls } from "../../../src/sidepanel/useSidepanelControls";
import type { Translate } from "../../../src/shared/i18n";
import MenuIcon from "../library/MenuIcon.vue";

const props = defineProps<{ actions: PanelActions; controls: SidepanelControls; translate: Translate }>();
const root = shallowRef<HTMLElement | null>(null);
const request = computed(() => props.actions.menu.value);
const item = computed(() => props.controls.collection.value.items.find(item => item.id === request.value?.id));
const entries = computed(() => [
  { action: "open", label: props.translate("openInNewTab"), icon: "open", danger: false },
  { action: "edit", label: props.translate("itemEdit"), icon: "pencil", danger: false },
  { action: "delete", label: props.translate("delete"), icon: "trash", danger: true }
] as const);
const position = shallowRef({ left: 8, top: 8 });
const active = ref(0);
const ready = ref(false);
let frame: number | undefined;
function restore(target: PanelMenuRequest): void {
  (target.trigger.isConnected ? target.trigger : document.querySelector<HTMLElement>("#searchInput"))?.focus({ preventScroll: true });
}
function close(focus = false): void { const target = request.value; props.actions.closeMenu(); if (focus && target) restore(target); }
function dismiss(): void { close(); }
function pick(action: PanelMenuAction): void {
  const target = request.value; if (!target) return;
  close(true); props.actions.pick(action, target.id);
}
function buttons(): HTMLButtonElement[] { return [...(root.value?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [])]; }
function focus(index: number): void {
  const list = buttons(); if (!list.length) return;
  active.value = (index + list.length) % list.length; list[active.value]?.focus({ preventScroll: true });
}
function keydown(event: KeyboardEvent): void {
  if (event.key === "Tab") { close(true); return; }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  const index = buttons().findIndex(button => button === document.activeElement);
  focus(event.key === "Home" ? 0 : event.key === "End" ? buttons().length - 1 : index + (event.key === "ArrowDown" ? 1 : -1));
}
function escape(event: KeyboardEvent): void {
  if (request.value && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
}
function outside(event: PointerEvent): void { if (event.target instanceof Node && !root.value?.contains(event.target)) close(); }
function scroll(event: Event): void { if (!(event.target instanceof Node) || !root.value?.contains(event.target)) close(); }
function cancelFrame(): void { if (frame !== undefined) cancelAnimationFrame(frame); frame = undefined; }
async function opened(target: PanelMenuRequest | null): Promise<void> {
  cancelFrame(); ready.value = false;
  if (!target) return;
  await nextTick();
  if (request.value !== target || !root.value) return;
  position.value = menuPosition(target.x, target.y, root.value.offsetWidth || 172, root.value.offsetHeight || 120, innerWidth, innerHeight);
  focus(0);
  frame = requestAnimationFrame(() => { frame = undefined; if (request.value === target) ready.value = true; });
}
function validate(): void { if (request.value && (!item.value || !cardTarget(item.value.url))) close(true); }
watch(request, opened, { flush: "post" });
watch(item, validate, { flush: "post" });
onMounted(() => {
  document.addEventListener("pointerdown", outside, true); document.addEventListener("keydown", escape, true);
  document.addEventListener("scroll", scroll, true); window.addEventListener("blur", dismiss); window.addEventListener("resize", dismiss);
});
onBeforeUnmount(() => {
  cancelFrame(); document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape, true);
  document.removeEventListener("scroll", scroll, true); window.removeEventListener("blur", dismiss); window.removeEventListener("resize", dismiss);
});
</script>

<template>
  <div v-if="request && item" ref="root" class="folder-menu" :class="{ 'is-open': ready }" role="menu" :aria-label="item.title || translate('itemFallback')"
    :style="{ left: `${position.left}px`, top: `${position.top}px` }" @keydown="keydown">
    <button v-for="(entry, index) in entries" :key="entry.action" type="button" class="folder-menu-item" :class="{ danger: entry.danger }"
      role="menuitem" :data-action="entry.action" :tabindex="index === active ? 0 : -1" @click.stop="pick(entry.action)">
      <MenuIcon :icon="entry.icon" /><span>{{ entry.label }}</span>
    </button>
  </div>
</template>
