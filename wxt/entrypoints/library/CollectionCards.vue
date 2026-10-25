<script setup lang="ts">
import { onMounted, onUpdated } from "vue";
import { useBatchedCards } from "../../../src/library/useBatchedCards";
import type { LibraryCollection } from "../../../src/library/shared";
import type { StoredItem } from "../../../src/storage/contracts";
import type { Translate } from "../../../src/shared/i18n";
import type { LibrarySelection } from "../../../src/library/useLibrarySelection";
import type { LibraryItems } from "../../../src/library/useLibraryItems";
import CollectionCard from "./CollectionCard.vue";

const props = defineProps<{
  items: readonly StoredItem[];
  collection: LibraryCollection;
  selectedIds: ReadonlySet<string>;
  selection: LibrarySelection;
  actions: LibraryItems;
  board: boolean;
  currentItemId: string | null;
  translate: Translate;
  english: boolean;
}>();
const emit = defineEmits<{ rendered: [complete: boolean]; select: [id: string, force?: boolean] }>();
const { rendered, complete } = useBatchedCards(() => props.items);
function notifyRendered(): void { emit("rendered", complete.value); }
function select(id: string, force?: boolean): void { emit("select", id, force); }
onMounted(notifyRendered);
onUpdated(notifyRendered);
</script>

<template>
  <section id="cardGrid" class="grid" :class="{ selecting: selection.active.value }" :hidden="board" aria-live="polite">
    <CollectionCard v-for="item in rendered" :key="item.id" :item="item" :collection="collection" :selection="selection" :actions="actions" @select="select"
      :selected="selectedIds.has(item.id)" :current="item.id === currentItemId" :translate="translate" :english="english" />
  </section>
</template>
