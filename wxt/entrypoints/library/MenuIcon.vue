<script setup lang="ts">
import type { MenuIcon } from "../../../src/library/menu";

defineProps<{ icon: MenuIcon }>();
const paths = {
  pin: "M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z",
  pencil: "M4 20h4L20 8l-4-4L4 16zM14 6l4 4",
  note: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h4",
  archive: "M3 4h18v4H3zM5 8v12h14V8M9 12h6",
  trash: "M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m3 0-1 13H7L6 7",
  open: "M14 5h5v5M19 5l-8 8M17 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5",
  multi: "M3.5 6.5h7v7h-7zM13.5 6.5h7v7h-7zM5 10l1.6 1.6L9 8",
  deselect: "M3.5 6.5h7v7h-7zM5.5 8.6l3 2.8M8.5 8.6l-3 2.8M14 10h6"
} as const;
</script>

<template>
  <svg viewBox="0 0 24 24" :class="{ 'pin-icon': icon === 'pin' || icon === 'unpin' }" aria-hidden="true">
    <path :d="paths[icon === 'unpin' ? 'pin' : icon]" />
    <path v-if="icon === 'unpin'" class="pin-slash" d="M4 20 20 4" />
  </svg>
</template>
