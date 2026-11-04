<script setup lang="ts">
import { DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuPortal, DropdownMenuContent, DropdownMenuItem } from "reka-ui";
import type { ItemLinkFormat } from "../../src/collection/item-link";
import type { Translate } from "../../src/shared/i18n";

defineProps<{ translate: Translate; disabled: boolean }>();
const emit = defineEmits<{ copy: [format: ItemLinkFormat] }>();
function copyUrl(): void { emit("copy", "url"); }
function copyMarkdown(): void { emit("copy", "markdown"); }
</script>

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

<style>
.item-copy { display: flex; align-items: stretch; flex: none; width: 43px; height: 29px; border-radius: 9px; background: transparent; color: var(--muted); }
.item-copy:hover, .item-copy[data-state="open"] { background: var(--btn-soft); color: var(--ink); }
.item-copy-main, .item-copy-toggle { display: grid; place-items: center; min-width: 0; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; }
.item-copy-main { flex: 1; border-radius: inherit; border-top-right-radius: 0; border-bottom-right-radius: 0; }
.item-copy-toggle { flex: none; width: 14px; border-left: 1px solid var(--hairline); border-radius: inherit; border-top-left-radius: 0; border-bottom-left-radius: 0; }
.item-copy-main:hover, .item-copy-toggle:hover { background: var(--btn-soft-hover); color: var(--ink); }
.item-copy-main:focus-visible, .item-copy-toggle:focus-visible { position: relative; outline: 2px solid var(--accent); outline-offset: 1px; }
.item-copy-main:disabled, .item-copy-toggle:disabled { opacity: .4; cursor: default; }
.item-copy svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.item-copy-toggle svg { width: 9px; height: 9px; }
.item-copy-menu { z-index: 100; min-width: 176px; max-width: calc(100vw - 16px); padding: 6px; border: 1px solid var(--card-line); border-radius: 13px; background: var(--card); color: var(--ink); box-shadow: var(--shadow-md); font-family: inherit; outline: none; }
.item-copy-choice { display: flex; align-items: center; min-height: 36px; padding: 8px 12px; border-radius: 8px; font-size: 12px; line-height: 1.5; cursor: pointer; outline: none; user-select: none; }
.item-copy-choice[data-highlighted] { background: var(--btn-soft); color: var(--ink); outline: 2px solid var(--accent); outline-offset: -2px; }
</style>
