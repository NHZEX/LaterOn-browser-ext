<script setup lang="ts">
import type { LibraryControls } from "../../../src/library/useLibraryControls";
import type { Translate } from "../../../src/shared/i18n";
import ProjectBoard from "./ProjectBoard.vue";

defineProps<{ controls: LibraryControls; translate: Translate; english: boolean }>();
</script>

<template>
  <section id="boardGrid" class="board-grid" aria-live="polite" :hidden="!controls.state.board">
    <template v-if="controls.state.board">
      <ProjectBoard v-for="group in controls.boards.value" :key="group.id" :group="group" :covers="controls.collection.value.covers" :controls="controls" :translate="translate" :english="english" />
      <button v-if="controls.state.activeProject !== 'archive'" type="button" class="board-create" :aria-label="translate('newProjectButton')" :title="translate('newProjectButton')" @click="controls.createProject">
        <span class="board-create-plus" aria-hidden="true">+</span><strong>{{ translate('newProject') }}</strong>
      </button>
    </template>
  </section>
</template>
