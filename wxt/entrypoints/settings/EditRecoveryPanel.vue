<script setup lang="ts">
import { ref, shallowRef } from "vue";
import { browser } from "wxt/browser";
import { t } from "../../../src/shared/i18n";
import { createStorageClient } from "../../../src/storage/client";
import { EPOCH } from "../../../src/storage/contracts";
import type { EditRecoveryEntry } from "../../../src/storage/edit-recovery";
import type { EpochSnapshot } from "../../../src/storage/contracts";
import type { SettingsDialog } from "./useDialog";

const props = defineProps<{ dialog: SettingsDialog }>();
const entries = shallowRef<readonly EditRecoveryEntry[] | null>(null);
const busy = ref(false);
const feedback = ref("");
const labels = { draft: "editRecoveryDraft", overwritten: "editRecoveryOverwritten", legacy: "editRecoveryLegacy" } as const;

function entryKey(entry: EditRecoveryEntry): string {
  return JSON.stringify([entry.itemId, entry.field, entry.kind, entry.value]);
}

async function request(action: "listEditRecovery" | "clearEditRecovery"): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  feedback.value = "";
  try {
    const client = createStorageClient({ sendMessage: message => browser.runtime.sendMessage(message), onInvalidated() {}, onFailure() {} });
    client.initialize(await browser.storage.local.get<EpochSnapshot>(EPOCH));
    const result = await client.run(action, {});
    entries.value = result.editRecovery ?? [];
  } catch { feedback.value = "operationFailed"; }
  finally { busy.value = false; }
}

function load(): Promise<void> { return request("listEditRecovery"); }

async function clear(): Promise<void> {
  if (!await props.dialog.confirm({ tone: "danger", title: t("editRecoveryClear"), message: t("editRecoveryClearNotice"), confirmText: t("editRecoveryClear") })) return;
  await request("clearEditRecovery");
}

async function copy(value: string): Promise<void> {
  try { await navigator.clipboard.writeText(value); feedback.value = "editRecoveryCopied"; }
  catch { feedback.value = "editRecoveryCopyFailed"; }
}
</script>

<template>
  <section class="settings-group" aria-labelledby="edit-recovery-heading">
    <h2 id="edit-recovery-heading">{{ t('editRecoveryTitle') }}</h2>
    <p class="setting-note">{{ t('editRecoveryHint') }}</p>
    <div class="edit-recovery-actions">
      <button class="setting-action" type="button" :disabled="busy" @click="load">{{ t(entries === null ? 'editRecoveryView' : 'editRecoveryRefresh') }}</button>
      <button v-if="entries?.length" class="setting-action" type="button" :disabled="busy" @click="clear">{{ t('editRecoveryClear') }}</button>
    </div>
    <p v-if="feedback" class="setting-note" role="status">{{ t(feedback) }}</p>
    <p v-if="entries?.length === 0" class="setting-note">{{ t('editRecoveryEmpty') }}</p>
    <ul v-if="entries?.length" class="edit-recovery-records" role="list">
      <li v-for="entry of entries" :key="entryKey(entry)" class="setting-row">
        <div class="setting-label edit-recovery-text">
          <strong>{{ entry.title || t('itemFallback') }}</strong>
          <span>{{ t(labels[entry.kind]) }} · {{ t(entry.field === 'title' ? 'title' : 'summary') }} · {{ new Date(entry.createdAt).toLocaleString() }}</span>
          <div class="edit-recovery-value">{{ entry.value || t('editRecoveryBlank') }}</div>
        </div>
        <button class="setting-action" type="button" @click="copy(entry.value)">{{ t('editRecoveryCopy') }}</button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.edit-recovery-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.edit-recovery-records { list-style: none; margin: 0.5rem 0 0; padding: 0; }
.edit-recovery-text { min-width: 0; overflow-wrap: anywhere; }
.edit-recovery-value { white-space: pre-wrap; }
</style>
