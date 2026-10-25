<script setup lang="ts">
import { ref, watch } from "vue";
import { nextCoverFallback } from "../../../src/library/shared";

const props = defineProps<{ source: string }>();
const placeholder = "/article-cover-placeholder.png";
// 小红书等图片 CDN 可能拒绝扩展来源的 Referer，模板中的图片需保留 no-referrer。
const current = ref(props.source);
// 降级链耗尽后清空图片来源，回到 LaterOn Logo 占位图。
function imageFailed(): void { current.value = nextCoverFallback(current.value); }
watch(() => props.source, value => { current.value = value; });
</script>

<template>
  <div class="cover">
    <img v-if="current" class="cover-img" :src="current" alt="" loading="lazy" referrerpolicy="no-referrer" @error="imageFailed" />
    <div v-else class="cover-placeholder"><img class="cover-logo" :src="placeholder" alt="" /></div>
  </div>
</template>
