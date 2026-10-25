<script setup lang="ts">
import { shallowRef, watch } from "vue";
import { nextCoverFallback } from "../../../src/shared/card-media";

const props = defineProps<{ source: string }>();
const placeholder = "/article-cover-placeholder.png";
const current = shallowRef(props.source);
function failed(): void { current.value = nextCoverFallback(current.value); }
watch(() => props.source, value => { current.value = value; });
</script>

<template>
  <div class="thumb">
    <!-- 占位始终在封面底下；降级链耗尽或移除封面后立即露出 Logo。 -->
    <!-- 小红书等 CDN 会拒绝扩展来源的 Referer，封面请求必须不发 Referer。 -->
    <img v-if="current" :key="current" class="thumb-img" :src="current" alt="" loading="lazy" referrerpolicy="no-referrer" @error="failed" />
    <div class="thumb-placeholder"><img class="thumb-logo" :src="placeholder" alt="" /></div>
  </div>
</template>
