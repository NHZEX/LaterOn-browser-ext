<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { LibraryControls } from "../../../src/library/useLibraryControls";
import type { Translate } from "../../../src/shared/i18n";
import LibraryHeader from "./LibraryHeader.vue";
import CollectionToolbar from "./CollectionToolbar.vue";
import ProjectNavigation from "./ProjectNavigation.vue";
import ProjectBoards from "./ProjectBoards.vue";
import CollectionCards from "./CollectionCards.vue";

const props = defineProps<{ controls: LibraryControls }>();
const languageVersion = ref(0);
const english = computed(() => {
  void languageVersion.value;
  return document.documentElement.lang === "en";
});
const translate: Translate = (key, values) => {
  void languageVersion.value;
  return globalThis.LaterOnI18n?.t(key, values) ?? key;
};
function refreshLanguage(): void { languageVersion.value++; }

onMounted(() => window.addEventListener("lateron-language-change", refreshLanguage));
onBeforeUnmount(() => {
  window.removeEventListener("lateron-language-change", refreshLanguage);
  props.controls.dispose();
});
</script>

<template>
  <Teleport to="#libraryHeader">
    <LibraryHeader :filter="controls.state.filter" :search="controls.state.search" :translate="translate"
      @filter="controls.setFilter" @search="controls.setSearch" @home="controls.home" />
  </Teleport>
  <Teleport to="#collectionToolbar">
    <CollectionToolbar :count="controls.state.board ? translate('boardCount', controls.boardSummary.value) : controls.state.count" :sort="controls.state.sort" :board="controls.state.board"
      :selecting="controls.state.selecting" :translate="translate" @sort="controls.setSort" @select="controls.select" />
  </Teleport>
  <Teleport to="#projectSidebar">
    <ProjectNavigation :controls="controls" :translate="translate" />
  </Teleport>
  <Teleport to="#boardView">
    <ProjectBoards :controls="controls" :translate="translate" :english="english" />
  </Teleport>
  <Teleport to="#cardGrid">
    <CollectionCards :items="controls.cards.value" :collection="controls.collection.value" :selected-ids="controls.selectedIds.value"
      :current-item-id="controls.state.currentItemId" :translate="translate" :english="english" @rendered="controls.cardsRendered" />
  </Teleport>
  <Teleport to="#libraryEmptyState">
    <section id="emptyState" class="empty" :hidden="controls.state.board ? controls.boards.value.length > 0 : !controls.state.empty">
      <img class="empty-icon" src="/icon128.png" alt="" />
      <h2>{{ translate(controls.state.board ? (controls.collection.value.items.length ? 'noBoard' : 'quiet') : controls.state.emptyTitle) }}</h2>
      <p>{{ translate(controls.state.board ? (controls.collection.value.items.length ? 'noBoardHint' : 'quietHint') : controls.state.emptyHint) }}</p>
    </section>
  </Teleport>
</template>
