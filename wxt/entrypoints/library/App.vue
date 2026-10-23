<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { LibraryControls } from "../../../src/library/useLibraryControls";
import type { Translate } from "../../../src/shared/i18n";
import LibraryHeader from "./LibraryHeader.vue";
import CollectionToolbar from "./CollectionToolbar.vue";

const props = defineProps<{ controls: LibraryControls }>();
const languageVersion = ref(0);
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
    <CollectionToolbar :count="controls.state.count" :sort="controls.state.sort" :board="controls.state.board"
      :selecting="controls.state.selecting" :translate="translate" @sort="controls.setSort" @select="controls.select" />
  </Teleport>
</template>
