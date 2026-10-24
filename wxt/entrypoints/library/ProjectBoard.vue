<script setup lang="ts">
import { computed } from "vue";
import { resolveImage } from "../../../src/collection/item-edit";
import { boardCoverItems, boardMeta, boardNote, formatSavedTime } from "../../../src/library/shared";
import type { BoardGroup, LibraryCollection } from "../../../src/library/shared";
import type { LibraryControls } from "../../../src/library/useLibraryControls";
import type { Translate } from "../../../src/shared/i18n";
import BoardImage from "./BoardImage.vue";

const props = defineProps<{ group: BoardGroup; covers: LibraryCollection['covers']; controls: LibraryControls; translate: Translate; english: boolean }>();
const note = computed(() => boardNote(props.group, props.translate, formatTime, props.english));
const meta = computed(() => boardMeta(props.group, props.translate, props.english));
const images = computed(() => props.group.cover ? [{ id: "custom", source: props.group.cover, fallback: false }]
  : boardCoverItems(props.group, props.covers).map(item => ({ id: item.id, source: resolveImage(item, props.covers), fallback: true })));
function formatTime(timestamp: number): string { return formatSavedTime(timestamp, Date.now(), props.translate, props.english); }
function open(): void { props.controls.project(props.group.id); }
function edit(): void { props.controls.editProject(props.group.id); }
function menu(event: MouseEvent): void {
  event.preventDefault();
  props.controls.projectMenu(props.group.id, event.clientX, event.clientY, event.currentTarget instanceof HTMLElement ? event.currentTarget : null);
}
function keydown(event: KeyboardEvent): void {
  if (event.target !== event.currentTarget || !(event.currentTarget instanceof HTMLElement)) return;
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); return; }
  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
  event.preventDefault();
  const rect = event.currentTarget.getBoundingClientRect();
  props.controls.projectMenu(props.group.id, rect.right, rect.top, event.currentTarget);
}
</script>

<template>
  <article class="board-card" :data-project="group.id" :draggable="controls.state.activeProject !== 'archive'" tabindex="0" aria-haspopup="menu"
    @click="open" @contextmenu="menu" @keydown="keydown">
    <div class="board-cover" :data-count="Math.max(images.length, 1)">
      <BoardImage v-for="image in images" :key="image.id" :source="image.source" :fallback="image.fallback" />
      <BoardImage v-if="!images.length" source="" :fallback="false" />
    </div>
    <button class="board-edit" type="button" :title="translate('editProjectAria')" :aria-label="translate('editProjectAria')" @click.stop="edit">
      <svg viewBox="0 0 24 24"><path d="M4 20h4L20 8l-4-4L4 16zM14 6l4 4" /></svg>
    </button>
    <div class="board-body">
      <h3 class="board-name" :title="group.name">{{ group.name }}</h3>
      <p class="board-note" :class="{ 'is-auto': note.auto }" :title="note.text">{{ note.text }}</p>
      <p class="board-meta">{{ meta }}</p>
    </div>
  </article>
</template>
