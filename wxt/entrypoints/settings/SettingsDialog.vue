<script setup lang="ts">
import { shallowRef } from "vue";
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from "reka-ui";
import { t } from "../../../src/shared/i18n";
import type { DialogRequest } from "./useDialog";

const props = defineProps<{ request: DialogRequest | null }>();
const emit = defineEmits<{ resolve: [confirmed: boolean] }>();

const cancelButton = shallowRef<HTMLButtonElement | null>(null);
const confirmButton = shallowRef<HTMLButtonElement | null>(null);
let returnFocus: HTMLElement | null = null;

function focusDialog(event: Event): void {
  event.preventDefault();
  returnFocus = props.request?.returnFocus ?? null;
  (cancelButton.value ?? confirmButton.value)?.focus();
}
function restoreFocus(event: Event): void {
  event.preventDefault();
  const target = returnFocus;
  // The caller clears its busy state after the confirmation promise settles.
  window.setTimeout(() => { if (target?.isConnected) target.focus(); }, 0);
}
function close(open: boolean): void { if (!open) emit("resolve", false); }
function cancel(): void { emit("resolve", false); }
function confirm(): void { emit("resolve", true); }
</script>

<template>
  <DialogRoot :open="!!request" @update:open="close">
    <DialogPortal v-if="request">
      <div class="lod-root is-in" :data-tone="request.tone">
        <DialogOverlay class="lod-backdrop" />
        <DialogContent class="lod-panel" @open-auto-focus="focusDialog" @close-auto-focus="restoreFocus">
          <div class="lod-head">
            <div class="lod-icon" aria-hidden="true">
              <svg v-if="request.tone === 'danger'" viewBox="0 0 24 24"><path d="M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20.4h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9.4v4.4M12 17h.01" /></svg>
              <svg v-else-if="request.tone === 'success'" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="m8.3 12.5 2.6 2.6 5-5.6" /></svg>
              <svg v-else-if="request.tone === 'question'" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M9.3 9.3a2.9 2.9 0 0 1 5.6 1c0 1.9-2.9 2.3-2.9 4.2M12 17.2h.01" /></svg>
              <svg v-else viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11.2v5.4M12 7.6h.01" /></svg>
            </div>
            <div class="lod-copy">
              <DialogTitle class="lod-title">{{ request.title }}</DialogTitle>
              <DialogDescription class="lod-message settings-dialog-message">{{ request.message }}</DialogDescription>
            </div>
          </div>
          <div class="lod-foot">
            <button v-if="request.kind === 'confirm'" ref="cancelButton" class="lod-cancel" type="button" @click="cancel">{{ t('cancel') }}</button>
            <button ref="confirmButton" class="lod-ok" type="button" @click="confirm">{{ request.confirmText || t('gotIt') }}</button>
          </div>
        </DialogContent>
      </div>
    </DialogPortal>
  </DialogRoot>
</template>
