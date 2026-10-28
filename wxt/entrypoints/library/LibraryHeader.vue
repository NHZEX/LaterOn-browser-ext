<script setup lang="ts">
import type { ReadFilter } from "../../../src/collection/filter";
import type { Translate } from "../../../src/shared/i18n";

defineProps<{ filter: ReadFilter; search: string; translate: Translate }>();
const emit = defineEmits<{ filter: [value: ReadFilter]; search: [value: string]; home: [] }>();

const filters = [{ value: "unread", label: "unread" }, { value: "done", label: "read" }, { value: "all", label: "all" }] as const;
function selectFilter(value: ReadFilter): void { emit("filter", value); }
function searchInput(event: Event): void {
  if (event.target instanceof HTMLInputElement) emit("search", event.target.value);
}
function home(event: MouseEvent): void { event.preventDefault(); emit("home"); }
</script>

<template>
  <a id="homeBrand" class="brand" href="#" :aria-label="translate('home')" :title="translate('home')" @click="home">
    <img class="brand-icon" src="/icon128.png" width="40" height="40" alt="" />StaySide
  </a>
  <nav :aria-label="translate('filterNav')">
    <button v-for="option in filters" :key="option.value" class="nav-item" :class="{ active: filter === option.value }"
      :data-filter="option.value" :aria-pressed="filter === option.value" @click="selectFilter(option.value)">{{ translate(option.label) }}</button>
  </nav>
  <label class="search">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.3-4.3m2.3-5.2a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" /></svg>
    <input id="searchInput" type="search" :value="search" :placeholder="translate('search')" :aria-label="translate('search')" autocomplete="off" @input="searchInput" />
    <kbd>⌘ K</kbd>
  </label>
</template>
