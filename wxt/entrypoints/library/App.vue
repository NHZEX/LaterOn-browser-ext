<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { LibraryControls } from "../../../src/library/useLibraryControls";
import { t } from "../../../src/shared/i18n";
import type { Translate } from "../../../src/shared/i18n";
import { initOnboarding } from "../../../src/ui/onboarding.js";
import LibraryHeader from "./LibraryHeader.vue";
import CollectionToolbar from "./CollectionToolbar.vue";
import ProjectNavigation from "./ProjectNavigation.vue";
import ProjectBoards from "./ProjectBoards.vue";
import CollectionCards from "./CollectionCards.vue";
import LibraryMenu from "./LibraryMenu.vue";
import BulkToolbar from "./BulkToolbar.vue";

const props = defineProps<{ controls: LibraryControls }>();
const languageVersion = ref(0);
let stopOnboarding: (() => void) | undefined;
const english = computed(() => {
  void languageVersion.value;
  return document.documentElement.lang === "en";
});
const translate: Translate = (key, values) => {
  void languageVersion.value;
  return t(key, values);
};
function refreshLanguage(): void { languageVersion.value++; }

onMounted(() => {
  stopOnboarding = initOnboarding(); window.addEventListener("lateron-language-change", refreshLanguage); props.controls.mount(); });
onBeforeUnmount(() => {
  stopOnboarding?.();
  window.removeEventListener("lateron-language-change", refreshLanguage);
  props.controls.dispose();
});
</script>

<template>
  <Teleport to="#libraryNotice"><div id="toast" class="toast" role="status"
    :class="{ show: controls.notice.state.visible, 'pill-toast': controls.notice.state.pill }">{{ controls.notice.state.message }}</div></Teleport>
  <Teleport to="body"><LibraryMenu :controls="controls" :translate="translate" /></Teleport>
  <Teleport to="#libraryBulkToolbar"><BulkToolbar :controls="controls" :translate="translate" /></Teleport>
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
  <Teleport to="#libraryCards">
    <CollectionCards :items="controls.cards.value" :collection="controls.collection.value" :selected-ids="controls.selectedIds.value" :selection="controls.selection"
      :board="controls.state.board" :actions="controls.items" :open="controls.openItem" :menu="controls.itemMenu" @select="controls.selection.toggle"
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
