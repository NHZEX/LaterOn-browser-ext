<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef } from "vue";
import { SwitchRoot, SwitchThumb } from "reka-ui";
import { configureSync, watchSync } from "../../../src/settings/sync-client";
import { t } from "../../../src/shared/i18n";
import type { Preferences, PreferencePreview, SyncField, SyncStatus } from "../../../src/settings/sync-shared";

const status = defineModel<SyncStatus | null>("status", { required: true });
const preview = shallowRef<PreferencePreview>();
const busy = ref(false);
const error = ref(false);
let unsubscribe: (() => void) | undefined;

const fieldLabels: Readonly<Record<SyncField, string>> = {
  theme: "theme", language: "language", defaultSort: "defaultSort", preset: "settingsSyncWebdav"
};
const valueLabels: Readonly<Record<Preferences[keyof Preferences], string>> = {
  light: "light", dark: "dark", system: "system", "zh-CN": "chinese", en: "english",
  newest: "sortNewest", oldest: "sortOldest", source: "sortSource", custom: "sortCustomDragged"
};

async function refresh(): Promise<void> {
  try { status.value = (await configureSync({ action: "status" })).status; }
  catch { if (!status.value) error.value = true; }
}

async function change(action: Parameters<typeof configureSync>[0]): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = false;
  try {
    const result = await configureSync(action);
    status.value = result.status;
    preview.value = result.preview;
  } catch { error.value = true; }
  finally { busy.value = false; }
}
function toggle(enabled: boolean): Promise<void> { return change({ action: enabled ? "enable" : "disable" }); }
function togglePreset(enabled: boolean): Promise<void> { return change({ action: "preset", enabled }); }
function resolvePreview(choice: "local" | "synced"): Promise<void> {
  return change({ action: "enable", choice, revision: preview.value?.revision });
}
function cancelPreview(): void { preview.value = undefined; }
function retry(): Promise<void> { return status.value ? change({ action: "retry" }) : refresh(); }

onMounted(() => { unsubscribe = watchSync(refresh); void refresh(); });
onUnmounted(() => unsubscribe?.());
</script>

<template>
  <section class="settings-group" aria-labelledby="settingsSyncLabel">
    <h2 id="settingsSyncLabel">{{ t('settingsSync') }}</h2>
    <div class="setting-row">
      <div class="setting-label"><strong id="settingsSyncEnable">{{ t('settingsSyncEnable') }}</strong><span id="settingsSyncHint">{{ t('settingsSyncHint') }}</span></div>
      <SwitchRoot class="switch" aria-labelledby="settingsSyncEnable" aria-describedby="settingsSyncHint" :model-value="status?.enabled ?? false" :disabled="!status || busy || !!preview" @update:model-value="toggle"><SwitchThumb class="slider" /></SwitchRoot>
    </div>
    <div v-if="preview" class="settings-sync-preview">
      <p class="setting-note">{{ t('settingsSyncCompare') }}</p>
      <table>
        <thead><tr><th scope="col">{{ t('settings') }}</th><th scope="col">{{ t('settingsSyncLocal') }}</th><th scope="col">{{ t('settingsSyncBrowser') }}</th></tr></thead>
        <tbody><tr v-for="difference in preview.differences" :key="difference.key">
          <th scope="row">{{ t(fieldLabels[difference.key]) }}</th><td>{{ t(valueLabels[difference.local]) }}</td><td>{{ t(valueLabels[difference.synced]) }}</td>
        </tr></tbody>
      </table>
      <div class="import-actions">
        <button class="setting-action" type="button" :disabled="busy" @click="resolvePreview('synced')">{{ t('settingsSyncUseBrowser') }}</button>
        <button class="setting-action" type="button" :disabled="busy" @click="resolvePreview('local')">{{ t('settingsSyncUploadLocal') }}</button>
        <button class="setting-action" type="button" :disabled="busy" @click="cancelPreview">{{ t('cancel') }}</button>
      </div>
    </div>
    <div v-if="status?.enabled" class="setting-row">
      <div class="setting-label"><strong id="settingsSyncPreset">{{ t('settingsSyncWebdav') }}</strong><span id="settingsSyncPresetHint">{{ t('settingsSyncWebdavHint') }}</span></div>
      <SwitchRoot class="switch" aria-labelledby="settingsSyncPreset" aria-describedby="settingsSyncPresetHint" :model-value="status.sharePreset" :disabled="busy" @update:model-value="togglePreset"><SwitchThumb class="slider" /></SwitchRoot>
    </div>
    <a v-if="status?.preset" class="setting-action settings-sync-action" href="#backup">{{ t('settingsSyncReviewPreset') }}</a>
    <p v-if="error || status?.unavailable" class="setting-note" role="alert">{{ t('settingsSyncUnavailable') }}</p>
    <p v-if="status?.failed.length" class="setting-note" role="alert">{{ t('settingsSyncFailed', { fields: status.failed.map(field => t(fieldLabels[field])).join(' · ') }) }}</p>
    <button v-if="status?.failed.length || (error && !status)" class="setting-action settings-sync-action" type="button" :disabled="busy" @click="retry">{{ t('retry') }}</button>
  </section>
</template>

<style scoped>
.settings-sync-preview { display: grid; gap: 10px; padding: 6px 0 14px; }
.settings-sync-preview table { width: 100%; border-collapse: collapse; color: var(--muted); font-size: 13px; }
.settings-sync-preview :is(th, td) { padding: 8px; border-bottom: 1px solid var(--hairline); text-align: start; }
.settings-sync-action { margin: 8px 0; }
</style>
