<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { SidepanelControls } from "../../../src/sidepanel/useSidepanelControls";
import type { Translate } from "../../../src/shared/i18n";
import { startSidepanelPage } from "../../../sidepanel.js";
import PanelControls from "./PanelControls.vue";
import PanelCards from "./PanelCards.vue";

const props = defineProps<{ controls: SidepanelControls }>();
const languageVersion = ref(0);
let stopPage: (() => void) | undefined;
const translate: Translate = (key, values) => {
  void languageVersion.value;
  return globalThis.LaterOnI18n?.t(key, values) ?? key;
};
function refreshLanguage(): void { languageVersion.value++; }
onMounted(() => { window.addEventListener("lateron-language-change", refreshLanguage); stopPage = startSidepanelPage(props.controls); });
onBeforeUnmount(() => { window.removeEventListener("lateron-language-change", refreshLanguage); props.controls.dispose(); stopPage?.(); });
</script>

<template>
  <Teleport to="#panelControls"><PanelControls :controls="controls" :translate="translate" /></Teleport>
  <PanelCards :controls="controls" :translate="translate" />
</template>
