<script setup lang="ts">
import { ref, watch } from "vue";
import type { Translate } from "../../../src/shared/i18n";

const props = defineProps<{ name: string; cover: string; pinned: boolean; translate: Translate }>();
const failed = ref(false);
function imageFailed(): void { failed.value = true; }
watch(() => props.cover, () => { failed.value = false; });
</script>

<template>
  <span class="nav-icon project-thumb">
    <img v-if="cover && !failed" :src="cover" alt="" loading="lazy" referrerpolicy="no-referrer" @error="imageFailed" />
    <span v-else class="project-ph">{{ (name || '·').trim().slice(0, 1) }}</span>
    <span v-if="pinned" class="project-pin-badge" :title="translate('pinned')">
      <svg viewBox="0 0 24 24" class="pin-icon"><path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z" /></svg>
    </span>
  </span>
</template>
