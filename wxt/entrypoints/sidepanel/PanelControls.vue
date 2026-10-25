<script setup lang="ts">
import { nextTick, onBeforeUnmount, shallowRef, watch } from "vue";
import type { ReadFilter } from "../../../src/collection/filter";
import type { SidepanelControls } from "../../../src/sidepanel/useSidepanelControls";
import type { Translate } from "../../../src/shared/i18n";

const props = defineProps<{ controls: SidepanelControls; translate: Translate }>();
const projectBar = shallowRef<HTMLElement | null>(null);
const filters = [{ value: "unread", label: "unread" }, { value: "done", label: "read" }, { value: "all", label: "all" }] as const;
let alive = true;
let frame: number | undefined;
function searchInput(event: Event): void {
  if (event.target instanceof HTMLInputElement) props.controls.setSearch(event.target.value);
}
function selectFilter(value: ReadFilter): void { props.controls.setFilter(value); }
function selectProject(id: string): void { props.controls.selectProject(id); }
function revealProject(): void {
  const container = projectBar.value;
  const active = container?.querySelector<HTMLElement>(".project-filter.active");
  if (!container || !active || !container.clientWidth) return;
  const viewport = container.getBoundingClientRect();
  const button = active.getBoundingClientRect();
  const left = viewport.left + 8;
  const right = viewport.left + container.clientWidth - 8;
  const delta = button.left < left ? button.left - left : button.right > right ? button.right - right : 0;
  if (delta) container.scrollLeft = Math.max(0, Math.min(container.scrollWidth - container.clientWidth, container.scrollLeft + delta));
}
async function scheduleReveal(): Promise<void> {
  await nextTick();
  if (!alive) return;
  if (frame !== undefined) cancelAnimationFrame(frame);
  // 等本轮布局完成，只移动横向项目栏，保留正在阅读的网页滚动位置。
  if (typeof requestAnimationFrame === "function") frame = requestAnimationFrame(revealProject);
  else revealProject();
}
watch([() => props.controls.state.project, props.controls.projects], scheduleReveal, { immediate: true });
onBeforeUnmount(() => { alive = false; if (frame !== undefined) cancelAnimationFrame(frame); });
</script>

<template>
  <label class="search">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.3-4.3m2.3-5.2a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" /></svg>
    <input id="searchInput" type="search" :value="controls.search.value" :placeholder="translate('search')" :aria-label="translate('search')" autocomplete="off" @input="searchInput" />
  </label>
  <div class="filter-row">
    <div class="filters" role="group" :aria-label="translate('filterNav')">
      <button v-for="option in filters" :key="option.value" class="filter" :class="{ active: controls.state.filter === option.value }"
        :data-filter="option.value" :aria-pressed="controls.state.filter === option.value" @click="selectFilter(option.value)">{{ translate(option.label) }}</button>
    </div>
    <span id="itemCount">{{ translate('cardCount', { n: controls.visible.value.length }) }}</span>
  </div>
  <div id="projectFilters" ref="projectBar" class="project-filters" :aria-label="translate('projectCategories')">
    <button v-for="project in controls.projects.value" :key="project.id" class="project-filter" :class="{ active: controls.state.project === project.id }"
      :data-project="project.id" :aria-pressed="controls.state.project === project.id" @click="selectProject(project.id)">
      <span class="project-name">{{ project.id === 'unfiled' ? translate('inbox') : project.name }}</span><strong>{{ project.count }}</strong>
    </button>
  </div>
</template>
