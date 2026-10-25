<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { isEmptySummary, resolveImage } from "../../../src/collection/item-edit";
import { cardTarget, formatSavedTime } from "../../../src/library/shared";
import type { LibraryCollection } from "../../../src/library/shared";
import type { StoredItem } from "../../../src/storage/contracts";
import type { Translate } from "../../../src/shared/i18n";
import type { LibrarySelection } from "../../../src/library/useLibrarySelection";
import type { LibraryItems } from "../../../src/library/useLibraryItems";
import CardCover from "./CardCover.vue";

const props = defineProps<{
  item: StoredItem;
  collection: LibraryCollection;
  selected: boolean;
  selection: LibrarySelection;
  actions: LibraryItems;
  open: (id: string, event: MouseEvent) => void;
  menu: (id: string, x: number, y: number, trigger: HTMLElement | null) => void;
  current: boolean;
  translate: Translate;
  english: boolean;
}>();
const emit = defineEmits<{ select: [id: string, force?: boolean] }>();
const target = computed(() => cardTarget(props.item.url) || "#");
const cover = computed(() => resolveImage(props.item, props.collection.covers));
const readLabel = computed(() => props.translate(props.item.status === "done" ? "unreadButton" : "readButton"));
const description = computed(() => isEmptySummary(props.item.description) ? props.translate("noDescription") : props.item.description);
const savedTime = computed(() => formatSavedTime(props.item.savedAt ?? 0, Date.now(), props.translate, props.english));
const projects = computed(() => props.collection.projects.filter(project => !project.archived || project.id === props.item.projectId));
const unknownProject = computed(() => props.item.projectId && !projects.value.some(project => project.id === props.item.projectId));
const faviconFailed = ref(false);
function hideFavicon(): void { faviconFailed.value = true; }
function select(event: MouseEvent): void {
  // 多选时标题和封面仍是真链接，需阻止默认跳转；复选框则保留原生点击与 Space 行为。
  if (!props.selection.active.value) return;
  if (event.target instanceof HTMLInputElement && event.target.classList.contains("select-check")) {
    event.stopPropagation(); return;
  }
  event.preventDefault(); event.stopPropagation(); emit("select", props.item.id);
}
function changeSelection(event: Event): void {
  // 以原生 change 的 checked 为准，不依赖各环境表现不同的 label 点击翻转。
  if (!props.selection.active.value || !(event.target instanceof HTMLInputElement)) return;
  event.stopPropagation(); emit("select", props.item.id, event.target.checked);
}
function preventProjectChange(event: KeyboardEvent): void {
  if (!props.selection.active.value || !(event.target instanceof HTMLSelectElement)) return;
  const typing = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
  if (!typing && !["Enter", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
}
// 标题、封面、摘要、来源和留白都可打开文章；真实控件保留各自操作。
function open(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest(".title-link, .cover-link") || !event.target.closest("button, select, input, label, a")) props.open(props.item.id, event);
}
// 多选时也保留右键菜单，阻止浏览器原生菜单覆盖页面菜单。
function menu(event: MouseEvent): void {
  event.preventDefault(); props.menu(props.item.id, event.clientX, event.clientY, event.currentTarget instanceof HTMLElement ? event.currentTarget : null);
}
function menuKey(event: KeyboardEvent): void {
  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
  event.preventDefault();
  const card = event.currentTarget;
  if (!(card instanceof HTMLElement)) return;
  const rect = card.getBoundingClientRect();
  props.menu(props.item.id, rect.right, rect.top, event.target instanceof HTMLElement ? event.target : card);
}
function edit(): void { void props.actions.edit(props.item.id); }
function read(): void { void props.actions.read(props.item.id); }
function remove(): void { void props.actions.remove(props.item.id); }
// 所属项目仍显示原生 select，但鼠标按下及 Enter / Space / 上下键统一打开共享锚定浮层。
// 实际选择由浮层提交，不让原生下拉再处理同一次操作。
function move(event: MouseEvent | KeyboardEvent): void {
  if (!(event.currentTarget instanceof HTMLElement)) return;
  event.preventDefault(); props.actions.move(props.item.id, event.currentTarget);
}
function projectKey(event: KeyboardEvent): void { if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) move(event); }
function projectMouse(event: MouseEvent): void { event.preventDefault(); }
function projectChange(event: Event): void {
  if (!(event.target instanceof HTMLSelectElement)) return;
  if (props.selection.active.value) { event.target.value = props.item.projectId || ""; return; }
  void props.actions.moveTo(props.item.id, event.target.value || null);
}
watch(() => props.item.favicon, () => { faviconFailed.value = false; });
</script>

<template>
  <article class="card" :data-id="item.id" draggable="true" tabindex="-1" :data-current-label="translate('currentReading')"
    :class="{ 'is-read': item.status === 'done', 'is-reading': item.status === 'reading', 'is-current': current, selected }" @click.capture="select" @keydown.capture="preventProjectChange" @click="open" @contextmenu="menu" @keydown="menuKey">
    <label class="select-badge" :aria-label="translate('selectItem')"><input type="checkbox" class="select-check" :checked="selected" @change="changeSelection" /></label>
    <a class="cover-link" :href="target" target="_blank" rel="noreferrer"><CardCover :source="cover" /></a>
    <button class="edit" :title="translate('editItemAria')" :aria-label="translate('editItemAria')" @click="edit">
      <svg viewBox="0 0 24 24"><path d="M4 20h4L20 8l-4-4L4 16zM14 6l4 4" /></svg>
    </button>
    <div class="card-body">
      <div class="source-row"><img class="favicon" :src="item.favicon || undefined" alt="" referrerpolicy="no-referrer"
        :style="{ visibility: faviconFailed ? 'hidden' : undefined }" @error="hideFavicon" /><span class="source-name">{{ item.source }}</span><span class="dot">·</span><time>{{ savedTime }}</time></div>
      <a class="title-link" :href="target" target="_blank" rel="noreferrer"><h2>{{ item.title }}</h2></a>
      <p class="description">{{ description }}</p>
      <footer>
        <button class="read-toggle" :title="translate('readStateAria')" :aria-label="readLabel" @click="read">{{ readLabel }}</button>
        <select class="project-select" :value="item.projectId || ''" :aria-label="translate('projectMembership')"
          @mousedown="projectMouse" @click="move" @keydown="projectKey" @change="projectChange">
          <option value="">{{ translate('inbox') }}</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
          <option v-if="unknownProject" :value="item.projectId || ''">{{ translate('newProject') }}</option>
        </select>
        <button class="delete" :title="translate('deleteSave')" :aria-label="translate('deleteSave')" @click="remove">
          <svg viewBox="0 0 24 24"><path d="M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m3 0-1 13H7L6 7" /></svg>
        </button>
      </footer>
    </div>
  </article>
</template>
