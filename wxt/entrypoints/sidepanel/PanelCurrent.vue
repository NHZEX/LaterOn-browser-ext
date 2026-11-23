<script setup lang="ts">
import { computed, onBeforeUnmount } from "vue";
import type { Translate } from "../../../src/shared/i18n";
import type { PanelCurrent } from "../../../src/sidepanel/usePanelCurrent";
import { usePanelThumbnail } from "../../../src/sidepanel/usePanelThumbnail";

const props = defineProps<{ current: PanelCurrent; translate: Translate }>();
const thumbnail = usePanelThumbnail(props.current.metadata);
const placeholder = "/article-cover-placeholder.png";
const style = computed(() => thumbnail.image.value ? { backgroundImage: `url("${thumbnail.image.value.replace(/"/g, "%22")}")` } : {});
const label = computed(() => {
  if (props.current.saved.value || props.current.topicUpdateBlocked.value) return props.translate("currentAdded");
  const topic = props.current.topic.value;
  if (!props.current.topicSaved.value) return props.translate("saveCurrent");
  return topic?.postNumber ? props.translate("updateDiscoursePosition", { n: topic.postNumber }) : props.translate("currentAdded");
});
onBeforeUnmount(thumbnail.dispose);
</script>

<template>
  <section class="save-panel">
    <div id="currentThumb" class="current-thumb" :class="{ 'has-cover': thumbnail.image.value }" :style="style"><img class="thumb-logo" :src="placeholder" alt="" /></div>
    <div class="current-copy">
      <p id="currentSource">{{ current.error.value || current.metadata.value?.source || translate("currentLoading") }}</p>
      <h1 id="currentTitle">{{ current.metadata.value?.title || translate("currentPage") }}</h1>
      <p class="current-topic-hint" role="status">{{ current.topicSaved.value ? translate(current.topicUpdateBlocked.value ? "discoursePositionSyncBound" : "currentTopicSaved") : "" }}</p>
    </div>
    <button id="saveCurrent" :disabled="current.disabled.value" :class="{ saved: current.saved.value }" :title="label" :aria-label="label" @click="current.save">
      <span>{{ current.saved.value ? "✓" : current.topicSaved.value ? "↻" : "＋" }}</span><span class="save-label">{{ label }}</span>
    </button>
    <select v-if="current.topicSaved.value && current.topic.value?.postNumber && !current.topicUpdateBlocked.value && current.topicItems.value.length > 1"
      v-model="current.topicTargetId.value" class="current-topic-target" :aria-label="translate('discourseTarget')" :disabled="current.saving.value">
      <option value="">{{ translate("discourseTarget") }}</option>
      <option v-for="{ item, postNumber } in current.topicItems.value" :key="item.id" :value="item.id">
        {{ postNumber ? translate("discoursePost", { n: postNumber }) : translate("discourseTopicLink") }} · {{ item.title || item.url }}
      </option>
    </select>
  </section>
</template>
