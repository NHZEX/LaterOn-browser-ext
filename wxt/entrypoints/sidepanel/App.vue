<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { SidepanelControls } from "../../../src/sidepanel/useSidepanelControls";
import type { Translate } from "../../../src/shared/i18n";
import { startSidepanelPage } from "../../../sidepanel.js";
import { usePanelActions } from "../../../src/sidepanel/usePanelActions";
import PanelControls from "./PanelControls.vue";
import PanelCards from "./PanelCards.vue";
import PanelMenu from "./PanelMenu.vue";

const props = defineProps<{ controls: SidepanelControls }>();
const actions = usePanelActions(props.controls);
const languageVersion = ref(0);
let stopPage: (() => void) | undefined;
const translate: Translate = (key, values) => {
  void languageVersion.value;
  return globalThis.LaterOnI18n?.t(key, values) ?? key;
};
function refreshLanguage(): void { languageVersion.value++; }
onMounted(() => { window.addEventListener("lateron-language-change", refreshLanguage); stopPage = startSidepanelPage(props.controls, actions.commands); actions.drag.mount(); });
onBeforeUnmount(() => { window.removeEventListener("lateron-language-change", refreshLanguage); actions.dispose(); props.controls.dispose(); stopPage?.(); });
</script>

<template>
  <Teleport to="#panelControls"><PanelControls :controls="controls" :translate="translate" /></Teleport>
  <PanelCards :controls="controls" :actions="actions" :translate="translate" />
  <Teleport to="body"><PanelMenu :controls="controls" :actions="actions" :translate="translate" /></Teleport>
</template>
