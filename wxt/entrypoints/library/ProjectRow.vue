<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import type { NavigationProject } from "../../../src/library/shared";
import type { LibraryControls } from "../../../src/library/useLibraryControls";
import type { Translate } from "../../../src/shared/i18n";
import ProjectThumbnail from "./ProjectThumbnail.vue";

const props = defineProps<{ project: NavigationProject; controls: LibraryControls; translate: Translate }>();
const renameInput = shallowRef<HTMLInputElement | null>(null);
const renaming = computed(() => props.controls.state.renamingId === props.project.id);
const menuOpen = computed(() => props.controls.menu.value?.kind === "project" && props.controls.menu.value.id === props.project.id);
const tip = computed(() => props.translate("projectTip", { name: props.project.name, pinned: props.project.pinned ? props.translate("pinnedPrefix") : "" }));

function select(): void { if (!renaming.value) props.controls.project(props.project.id); }
function rename(event: MouseEvent): void {
  if (renaming.value) return;
  event.preventDefault();
  props.controls.rename(props.project.id);
}
function menu(event: MouseEvent): void {
  event.preventDefault();
  props.controls.projectMenu(props.project.id, event.clientX, event.clientY, event.currentTarget instanceof HTMLElement ? event.currentTarget : null);
}
function more(event: MouseEvent): void {
  if (!(event.currentTarget instanceof HTMLElement)) return;
  const rect = event.currentTarget.getBoundingClientRect();
  props.controls.projectMenu(props.project.id, rect.right, rect.bottom + 6, event.currentTarget);
}
function menuKey(event: KeyboardEvent): void {
  if (event.target instanceof HTMLInputElement || (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))) return;
  if (!(event.currentTarget instanceof HTMLElement)) return;
  event.preventDefault();
  const rect = event.currentTarget.getBoundingClientRect();
  props.controls.projectMenu(props.project.id, rect.right, rect.bottom + 6, event.currentTarget);
}
function input(event: Event): void {
  if (event.target instanceof HTMLInputElement) props.controls.state.renameDraft = event.target.value;
}
function keydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (event.key === "Enter") { event.preventDefault(); renameInput.value?.blur(); }
  if (event.key === "Escape") { event.preventDefault(); props.controls.cancelRename(); }
}
function commit(): void { props.controls.commitRename(props.project.id, props.controls.state.renameDraft); }
function focusRename(): void {
  if (!renaming.value || !renameInput.value) return;
  renameInput.value.focus();
  renameInput.value.select();
}
watch(renaming, focusRename, { flush: "post" });
</script>

<template>
  <div class="project-row" :class="{ 'is-pinned': project.pinned }" :data-id="project.id" :data-project="project.id" draggable="true">
    <button type="button" class="project-nav" :class="{ active: controls.state.activeProject === project.id, 'is-renaming': renaming }"
      :data-project="project.id" :aria-label="project.name" :title="tip" aria-haspopup="menu" :aria-expanded="menuOpen"
      @click="select" @dblclick="rename" @contextmenu="menu" @keydown="menuKey">
      <ProjectThumbnail :name="project.name" :cover="project.cover" :pinned="project.pinned" :translate="translate" />
      <input v-if="renaming" ref="renameInput" class="project-rename" :value="controls.state.renameDraft" maxlength="28" autocomplete="off"
        :aria-label="translate('projectNameLabel')" @input="input" @click.stop @dblclick.stop @keydown="keydown" @blur="commit" />
      <span v-else class="project-name" :title="tip">{{ project.name }}</span>
      <strong class="nav-count">{{ project.count }}</strong>
    </button>
    <button type="button" class="project-more" :title="translate('moreActions')" :aria-label="translate('projectAria', { name: project.name })"
      aria-haspopup="menu" :aria-expanded="menuOpen" :aria-controls="menuOpen ? 'libraryContextMenu' : undefined" @click.stop="more" @keydown="menuKey">⋯</button>
  </div>
</template>
