<script setup lang="ts">
import { onMounted, onUpdated } from "vue";
import { useBatchedCards } from "../../../src/library/useBatchedCards";
import type { LibraryCollection } from "../../../src/library/shared";
import type { StoredItem } from "../../../src/storage/contracts";
import type { Translate } from "../../../src/shared/i18n";
import CollectionCard from "./CollectionCard.vue";

const props = defineProps<{
  items: readonly StoredItem[];
  collection: LibraryCollection;
  selectedIds: ReadonlySet<string>;
  currentItemId: string | null;
  translate: Translate;
  english: boolean;
}>();
const emit = defineEmits<{ rendered: [complete: boolean] }>();
const { rendered, complete } = useBatchedCards(() => props.items);
function notifyRendered(): void { emit("rendered", complete.value); }
onMounted(notifyRendered);
onUpdated(notifyRendered);
</script>

<template>
  <CollectionCard v-for="item in rendered" :key="item.id" :item="item" :collection="collection"
    :selected="selectedIds.has(item.id)" :current="item.id === currentItemId" :translate="translate" :english="english" />
</template>
