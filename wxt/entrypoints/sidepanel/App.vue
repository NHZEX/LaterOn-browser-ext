<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { SidepanelControls } from "../../../src/sidepanel/useSidepanelControls";
import type { Translate } from "../../../src/shared/i18n";
import { usePanelPage } from "../../../src/sidepanel/usePanelPage";
import { usePanelActions } from "../../../src/sidepanel/usePanelActions";
import PanelControls from "./PanelControls.vue";
import PanelCards from "./PanelCards.vue";
import PanelMenu from "./PanelMenu.vue";
import PanelCurrent from "./PanelCurrent.vue";

const props = defineProps<{ controls: SidepanelControls }>();
const actions = usePanelActions(props.controls);
const page = usePanelPage(props.controls, actions.commands);
const languageVersion = ref(0);
let alive = true;
const translate: Translate = (key, values) => {
  void languageVersion.value;
  return globalThis.LaterOnI18n?.t(key, values) ?? key;
};
function refreshLanguage(): void { if (alive) languageVersion.value++; }
onMounted(() => {
  window.addEventListener("lateron-language-change", refreshLanguage);
  page.mount(); actions.drag.mount();
  void globalThis.LaterOnI18n?.ready.then(refreshLanguage, refreshLanguage);
});
onBeforeUnmount(() => {
  alive = false; window.removeEventListener("lateron-language-change", refreshLanguage);
  page.dispose(); actions.dispose(); props.controls.dispose();
});
</script>

<template>
  <Teleport to="header">
    <button id="openLibrary" class="icon-button" :disabled="page.navigation.opening.value" :title="translate('openLibrary')" :aria-label="translate('openLibrary')" @click="page.navigation.openLibrary">
      <svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M8 21H5a2 2 0 0 1-2-2v-3m18 0v3a2 2 0 0 1-2 2h-3" /></svg>
    </button>
  </Teleport>
  <Teleport to="#panelDiagnostics"><div id="slowBanner" class="slow-banner" role="status" :hidden="!page.banner.value">{{ page.banner.value }}</div></Teleport>
  <Teleport to="#panelCurrent"><PanelCurrent :current="page.current" :translate="translate" /></Teleport>
  <Teleport to="#panelStatus"><p id="status" role="status">{{ controls.message.value }}</p></Teleport>
  <Teleport to="#panelControls"><PanelControls :controls="controls" :translate="translate" /></Teleport>
  <PanelCards :controls="controls" :actions="actions" :translate="translate" />
  <Teleport to="body"><PanelMenu :controls="controls" :actions="actions" :translate="translate" /></Teleport>
</template>
