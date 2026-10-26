<script setup lang="ts">
import { computed, onBeforeUnmount } from "vue";
import type { Translate } from "../../../src/shared/i18n";
import type { PanelCurrent } from "../../../src/sidepanel/usePanelCurrent";
import { usePanelThumbnail } from "../../../src/sidepanel/usePanelThumbnail";

const props = defineProps<{ current: PanelCurrent; translate: Translate }>();
const thumbnail = usePanelThumbnail(props.current.metadata);
const placeholder = "/article-cover-placeholder.png";
const style = computed(() => thumbnail.image.value ? { backgroundImage: `url("${thumbnail.image.value.replace(/"/g, "%22")}")` } : {});
const label = computed(() => props.translate(props.current.saved.value ? "currentAdded" : "saveCurrent"));
onBeforeUnmount(thumbnail.dispose);
</script>

<template>
  <section class="save-panel">
    <div id="currentThumb" class="current-thumb" :class="{ 'has-cover': thumbnail.image.value }" :style="style"><img class="thumb-logo" :src="placeholder" alt="" /></div>
    <div class="current-copy">
      <p id="currentSource">{{ current.error.value || current.metadata.value?.source || translate("currentLoading") }}</p>
      <h1 id="currentTitle">{{ current.metadata.value?.title || translate("currentPage") }}</h1>
    </div>
    <button id="saveCurrent" :disabled="current.disabled.value" :class="{ saved: current.saved.value }" :title="label" :aria-label="label" @click="current.save">
      <span>{{ current.saved.value ? "✓" : "＋" }}</span><span class="save-label">{{ label }}</span>
    </button>
  </section>
</template>
