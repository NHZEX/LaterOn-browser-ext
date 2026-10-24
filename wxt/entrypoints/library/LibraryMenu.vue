<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { libraryMenuContent, menuPosition } from "../../../src/library/menu";
import type { LibraryMenuAction, LibraryMenuRequest } from "../../../src/library/menu";
import type { LibraryControls } from "../../../src/library/useLibraryControls";
import type { Translate } from "../../../src/shared/i18n";
import MenuIcon from "./MenuIcon.vue";

const props = defineProps<{ controls: LibraryControls; translate: Translate }>();
const root = shallowRef<HTMLElement | null>(null);
const request = computed(() => props.controls.menu.value);
const content = computed(() => request.value ? libraryMenuContent(props.controls.collection.value, request.value,
  props.controls.selectedIds.value, props.controls.state.selecting, props.translate) : null);
const position = shallowRef({ left: 8, top: 8 });
const active = ref(0);
const ready = ref(false);
let frame: number | undefined;

function restoreFocus(target: LibraryMenuRequest): void {
  const trigger = target.trigger?.isConnected ? target.trigger : document.querySelector<HTMLElement>("#searchInput");
  trigger?.focus({ preventScroll: true });
}
function close(restore = false): void {
  const target = request.value;
  props.controls.closeMenu();
  if (restore && target) restoreFocus(target);
}
function pick(action: LibraryMenuAction): void {
  const target = request.value;
  if (!target || !content.value) return;
  close(true);
  props.controls.menuAction(target, action);
}
function buttons(): HTMLButtonElement[] { return [...(root.value?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [])]; }
function focus(index: number): void {
  const entries = buttons();
  if (!entries.length) return;
  active.value = (index + entries.length) % entries.length;
  entries[active.value]?.focus({ preventScroll: true });
}
function keydown(event: KeyboardEvent): void {
  if (event.key === "Tab") { close(true); return; }
  const index = buttons().findIndex(button => button === document.activeElement);
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  focus(event.key === "Home" ? 0 : event.key === "End" ? buttons().length - 1 : index + (event.key === "ArrowDown" ? 1 : -1));
}
function escape(event: KeyboardEvent): void {
  if (!request.value || event.key !== "Escape") return;
  event.preventDefault(); event.stopPropagation(); close(true);
}
function outside(event: PointerEvent): void {
  if (request.value && event.target instanceof Node && !root.value?.contains(event.target)) close();
}
function scroll(event: Event): void {
  if (event.target instanceof Node && root.value?.contains(event.target)) return;
  close();
}
function dismiss(): void { close(); }
function cancelFrame(): void { if (frame !== undefined) cancelAnimationFrame(frame); frame = undefined; }
async function opened(target: LibraryMenuRequest | null): Promise<void> {
  cancelFrame(); ready.value = false;
  if (!target) return;
  await nextTick();
  if (request.value !== target || !root.value) return;
  position.value = menuPosition(target.x, target.y, root.value.offsetWidth || 180, root.value.offsetHeight || 96, innerWidth, innerHeight);
  focus(0);
  frame = requestAnimationFrame(() => { if (request.value === target) ready.value = true; });
}
function validateTarget(): void { if (request.value && !content.value) close(true); }

watch(request, opened, { flush: "post" });
watch(content, validateTarget, { flush: "post" });
onMounted(() => {
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("keydown", escape, true);
  document.addEventListener("scroll", scroll, true);
  window.addEventListener("blur", dismiss);
  window.addEventListener("resize", dismiss);
});
onBeforeUnmount(() => {
  cancelFrame();
  document.removeEventListener("pointerdown", outside, true);
  document.removeEventListener("keydown", escape, true);
  document.removeEventListener("scroll", scroll, true);
  window.removeEventListener("blur", dismiss);
  window.removeEventListener("resize", dismiss);
});
</script>

<template>
  <div v-if="request && content" id="libraryContextMenu" ref="root" class="folder-menu" :class="{ 'is-open': ready }"
    role="menu" :aria-label="content.title" :style="{ left: `${position.left}px`, top: `${position.top}px` }" @keydown="keydown">
    <p class="folder-menu-title" :title="content.title">{{ content.heading }}</p>
    <button v-for="(entry, index) in content.entries" :key="entry.action" type="button" class="folder-menu-item"
      :class="{ danger: entry.danger }" role="menuitem" :tabindex="index === active ? 0 : -1" :data-action="entry.action" @click.stop="pick(entry.action)">
      <MenuIcon :icon="entry.icon" /><span>{{ entry.label }}</span>
    </button>
  </div>
</template>
