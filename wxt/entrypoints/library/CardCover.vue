<script setup lang="ts">
import { ref, watch } from "vue";
import { nextCoverFallback } from "../../../src/library/shared";

const props = defineProps<{ source: string }>();
const placeholder = "/article-cover-placeholder.png";
const current = ref(props.source);
function imageFailed(): void { current.value = nextCoverFallback(current.value); }
watch(() => props.source, value => { current.value = value; });
</script>

<template>
  <div class="cover">
    <img v-if="current" class="cover-img" :src="current" alt="" loading="lazy" referrerpolicy="no-referrer" @error="imageFailed" />
    <div v-else class="cover-placeholder"><img class="cover-logo" :src="placeholder" alt="" /></div>
  </div>
</template>
