<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import { cardTarget } from "../../../src/shared/card-media";
import { resolveImage } from "../../../src/collection/item-edit";
import { panelSavedTime } from "../../../src/sidepanel/shared";
import type { StoredItem } from "../../../src/storage/contracts";
import type { Translate } from "../../../src/shared/i18n";
import PanelCover from "./PanelCover.vue";

const props = defineProps<{ item: StoredItem; covers: Readonly<Record<string, string>>; current: boolean; translate: Translate }>();
const faviconFailed = shallowRef(false);
// 文字直接写明「标为已读 / 标为未读」；在读仍由打开文章进入。
const readLabel = computed(() => props.translate(props.item.status === "done" ? "unreadButton" : "readButton"));
const cover = computed(() => resolveImage(props.item, props.covers));
const savedTime = computed(() => {
  // 语言由上层响应式翻译入口驱动，日期的 locale 同步切换。
  props.translate("today");
  return panelSavedTime(props.item.savedAt, document.documentElement.lang, props.translate);
});
function hideFavicon(): void { faviconFailed.value = true; }
watch(() => props.item.favicon, () => { faviconFailed.value = false; });
</script>

<template>
  <article class="item" :class="{ 'is-read': item.status === 'done', 'is-reading': item.status === 'reading', 'is-current': current }"
    :data-id="item.id" :data-current-label="translate('currentReading')" draggable="true">
    <a class="open-item" :href="cardTarget(item.url) || '#'" target="_blank" rel="noreferrer" :title="translate('openInNewTab')">
      <PanelCover :source="cover" />
      <div class="copy">
        <div class="meta"><img :src="item.favicon || undefined" alt="" referrerpolicy="no-referrer" :style="{ visibility: faviconFailed ? 'hidden' : undefined }" @error="hideFavicon" /><span class="source">{{ item.source }}</span><span class="dot">·</span><time>{{ savedTime }}</time></div>
        <h2>{{ item.title }}</h2>
        <p class="description">{{ item.description }}</p>
      </div>
    </a>
    <!-- 交互暂由稳定列表容器委托；E3 再迁移命令，不与 Vue 争夺节点所有权。 -->
    <button class="read-toggle" :class="{ 'is-on': item.status === 'done' }" :aria-label="readLabel" :title="readLabel">{{ readLabel }}</button>
    <button class="edit" :title="translate('editItemAria')" :aria-label="translate('editItemAria')"><svg viewBox="0 0 24 24"><path d="M4 20h4L20 8l-4-4L4 16zM14 6l4 4" /></svg></button>
    <button class="delete" :title="translate('deleteSave')" :aria-label="translate('deleteSave')"><svg viewBox="0 0 24 24"><path d="M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m3 0-1 13H7L6 7" /></svg></button>
  </article>
</template>
