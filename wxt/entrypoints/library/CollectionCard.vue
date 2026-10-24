<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { isEmptySummary, resolveImage } from "../../../src/collection/item-edit";
import { cardTarget, formatSavedTime } from "../../../src/library/shared";
import type { LibraryCollection } from "../../../src/library/shared";
import type { StoredItem } from "../../../src/storage/contracts";
import type { Translate } from "../../../src/shared/i18n";
import CardCover from "./CardCover.vue";

const props = defineProps<{
  item: StoredItem;
  collection: LibraryCollection;
  selected: boolean;
  current: boolean;
  translate: Translate;
  english: boolean;
}>();
const target = computed(() => cardTarget(props.item.url) || "#");
const cover = computed(() => resolveImage(props.item, props.collection.covers));
const readLabel = computed(() => props.translate(props.item.status === "done" ? "unreadButton" : "readButton"));
const description = computed(() => isEmptySummary(props.item.description) ? props.translate("noDescription") : props.item.description);
const savedTime = computed(() => formatSavedTime(props.item.savedAt ?? 0, Date.now(), props.translate, props.english));
const projects = computed(() => props.collection.projects.filter(project => !project.archived || project.id === props.item.projectId));
const unknownProject = computed(() => props.item.projectId && !projects.value.some(project => project.id === props.item.projectId));
const faviconFailed = ref(false);
function hideFavicon(): void { faviconFailed.value = true; }
watch(() => props.item.favicon, () => { faviconFailed.value = false; });
</script>

<template>
  <article class="card" :data-id="item.id" draggable="true" :data-current-label="translate('currentReading')"
    :class="{ 'is-read': item.status === 'done', 'is-reading': item.status === 'reading', 'is-current': current, selected }">
    <label class="select-badge" :aria-label="translate('selectItem')"><input type="checkbox" class="select-check" :checked="selected" /></label>
    <a class="cover-link" :href="target" target="_blank" rel="noreferrer"><CardCover :source="cover" /></a>
    <button class="edit" :title="translate('editItemAria')" :aria-label="translate('editItemAria')">
      <svg viewBox="0 0 24 24"><path d="M4 20h4L20 8l-4-4L4 16zM14 6l4 4" /></svg>
    </button>
    <div class="card-body">
      <div class="source-row"><img class="favicon" :src="item.favicon || undefined" alt="" referrerpolicy="no-referrer"
        :style="{ visibility: faviconFailed ? 'hidden' : undefined }" @error="hideFavicon" /><span class="source-name">{{ item.source }}</span><span class="dot">·</span><time>{{ savedTime }}</time></div>
      <a class="title-link" :href="target" target="_blank" rel="noreferrer"><h2>{{ item.title }}</h2></a>
      <p class="description">{{ description }}</p>
      <footer>
        <button class="read-toggle" :title="translate('readStateAria')" :aria-label="readLabel">{{ readLabel }}</button>
        <select class="project-select" :value="item.projectId || ''" :aria-label="translate('projectMembership')">
          <option value="">{{ translate('inbox') }}</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
          <option v-if="unknownProject" :value="item.projectId || ''">{{ translate('newProject') }}</option>
        </select>
        <button class="delete" :title="translate('deleteSave')" :aria-label="translate('deleteSave')">
          <svg viewBox="0 0 24 24"><path d="M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m3 0-1 13H7L6 7" /></svg>
        </button>
      </footer>
    </div>
  </article>
</template>
