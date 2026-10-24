<script setup lang="ts">
import { ref, watch } from "vue";
import { nextCoverFallback } from "../../../src/library/shared";

const props = defineProps<{ source: string; fallback: boolean }>();
// Reuse the public asset required by classic pages instead of bundling another copy.
const placeholder = "/article-cover-placeholder.png";
const current = ref(props.source);
function imageFailed(): void { current.value = props.fallback ? nextCoverFallback(current.value) : ""; }
watch(() => props.source, value => { current.value = value; });
</script>

<template>
  <div class="board-cell">
    <img v-if="current" class="board-img" :src="current" alt="" loading="lazy" referrerpolicy="no-referrer" @error="imageFailed" />
    <img v-else class="board-placeholder" :src="placeholder" alt="" />
  </div>
</template>
