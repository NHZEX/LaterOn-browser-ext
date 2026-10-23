<script setup lang="ts">
import type { SortMode } from "../../../src/collection/filter";
import type { Translate } from "../../../src/shared/i18n";

defineProps<{ count: string; sort: SortMode; board: boolean; selecting: boolean; translate: Translate }>();
const emit = defineEmits<{ sort: [value: string]; select: [] }>();

function changeSort(event: Event): void {
  if (event.target instanceof HTMLSelectElement) emit("sort", event.target.value);
}
function select(): void { emit("select"); }
</script>

<template>
  <div class="collection-left">
    <p id="countText">{{ count || translate('readingSaves') }}</p>
    <button id="selectMode" type="button" class="select-mode" :class="{ active: selecting }" :aria-pressed="selecting" :hidden="board" @click="select">{{ translate('select') }}</button>
  </div>
  <div class="collection-right">
    <select id="sortSelect" :value="sort" :hidden="board" :aria-label="translate('sortAria')" @change="changeSort">
      <option value="newest">{{ translate('sortNewest') }}</option>
      <option value="oldest">{{ translate('sortOldest') }}</option>
      <option value="source">{{ translate('sortSource') }}</option>
      <option value="custom">{{ translate('sortCustom') }}</option>
    </select>
  </div>
</template>
