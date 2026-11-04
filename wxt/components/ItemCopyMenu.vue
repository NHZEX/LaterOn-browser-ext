<script setup lang="ts">
import { DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuPortal, DropdownMenuContent, DropdownMenuItem } from "reka-ui";
import type { ItemLinkFormat } from "../../src/collection/item-link";
import type { Translate } from "../../src/shared/i18n";

defineProps<{ translate: Translate; disabled: boolean }>();
const emit = defineEmits<{ copy: [format: ItemLinkFormat] }>();
function copyUrl(): void { emit("copy", "url"); }
function copyMarkdown(): void { emit("copy", "markdown"); }
</script>

<!-- Shared styles are loaded by each page HTML entry: src/styles/item-copy.css. -->
<template>
  <DropdownMenuRoot v-slot="{ open }" :modal="false">
    <div class="item-copy" role="group" :aria-label="translate('copyLink')" :data-state="open ? 'open' : 'closed'" @click.stop>
      <button class="item-copy-main" type="button" :disabled="disabled" :title="translate('copyPlainUrl')" :aria-label="translate('copyPlainUrl')" @click="copyUrl">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4" /></svg>
      </button>
      <DropdownMenuTrigger as-child :disabled="disabled">
        <button class="item-copy-toggle" type="button" :title="translate('copyMoreFormats')" :aria-label="translate('copyMoreFormats')">
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent class="item-copy-menu" side="top" align="end" :side-offset="6" :collision-padding="8" :aria-label="translate('copyMoreFormats')">
          <DropdownMenuItem class="item-copy-choice" @select="copyUrl">{{ translate('copyPlainUrl') }}</DropdownMenuItem>
          <DropdownMenuItem class="item-copy-choice" @select="copyMarkdown">{{ translate('copyMarkdownUrl') }}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </div>
  </DropdownMenuRoot>
</template>
