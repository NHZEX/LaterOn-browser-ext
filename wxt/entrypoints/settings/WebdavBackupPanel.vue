<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from "vue";
import { recoveryBackup, recoveryStatus } from "../../../src/backup/client";
import * as remote from "../../../src/backup/webdav-client";
import { DEFAULT_BACKUP_OPTIONS, MIB, normalizeBackupEndpoint } from "../../../src/backup/webdav-shared";
import { configureSync, watchSync } from "../../../src/settings/sync-client";
import { selectPreset } from "../../../src/settings/sync-shared";
import { isRecord } from "../../../src/storage/contracts";
import { t } from "../../../src/shared/i18n";
import { restoreBackup, saveBackupFile, saveDownload } from "./backup-actions";
import { backupErrorKey } from "./shared";
import type { ImportMode } from "../../../src/backup/client";
import type { BackupOptions, BackupStatus, RemoteBackup } from "../../../src/backup/webdav-shared";
import type { SyncStatus, WebdavPreset } from "../../../src/settings/sync-shared";
import type { SettingsDialog } from "./useDialog";

const props = defineProps<{ dialog: SettingsDialog }>();
const busy = defineModel<boolean>("busy", { default: false });
const hasRecovery = defineModel<boolean>("hasRecovery", { required: true });
const status = shallowRef<BackupStatus | null>(null);
const form = reactive({ ...DEFAULT_BACKUP_OPTIONS });
const password = ref("");
const entries = shallowRef<readonly RemoteBackup[]>([]);
const loadedList = ref(false);
const restoreMode = ref<ImportMode>("merge");
const manualImages = ref(false);
const note = ref("");
const error = ref("");
const configDetails = shallowRef<HTMLDetailsElement>();
const configForm = shallowRef<HTMLFormElement>();
const sync = shallowRef<SyncStatus>();
const draftOrigin = shallowRef<WebdavPreset>();
const testToken = ref("");
let stopSync: (() => void) | undefined;
const activeSettings = computed(() => status.value?.options);
const dirty = computed(() => !!password.value || (Object.keys(form) as (keyof BackupOptions)[])
  .some(key => form[key] !== activeSettings.value?.[key]));
const onlineActions = computed(() => status.value?.configured === true && (!!draftOrigin.value || !dirty.value) && !busy.value);
const needsPassword = computed(() => {
  if (!status.value?.configured) return true;
  if (!draftOrigin.value) return false;
  try { return activeSettings.value?.endpoint !== normalizeBackupEndpoint(form.endpoint) ||
    activeSettings.value?.username !== form.username.trim(); }
  catch { return true; }
});
const draftAvailable = computed(() => {
  if (!sync.value?.preset) return false;
  const current = draftOrigin.value ?? (activeSettings.value && selectPreset(activeSettings.value));
  return JSON.stringify(sync.value.preset) !== JSON.stringify(current);
});
const used = computed(() => status.value ? sizeLabel(status.value.usage.uploaded + status.value.usage.downloaded) : "0");
const uncertainUpload = computed(() => {
  const bytes = status.value?.usage.uncertainUploaded ?? 0;
  return bytes ? (Math.ceil(bytes * 100 / MIB) / 100).toFixed(2) : "";
});
const errors: Readonly<Record<string, string>> = {
  WEBDAV_SETTINGS: "webdavInvalidSettings", WEBDAV_NETWORK: "webdavNetwork",
  WEBDAV_HTTP_401: "webdavUnauthorized", WEBDAV_HTTP_403: "webdavForbidden", WEBDAV_HTTP_404: "webdavMissing",
  WEBDAV_DIRECTORY: "webdavDirectoryError", WEBDAV_BUDGET: "webdavBudgetReached", WEBDAV_LIST_LIMIT: "webdavListTooLong",
  WEBDAV_INVALID_BACKUP: "webdavInvalidArchive", WEBDAV_PRESET_TEST: "webdavPresetRetest"
};

function sizeLabel(bytes: number): string {
  return (bytes / MIB).toFixed(2);
}
function entryKey(entry: RemoteBackup): string {
  return `${entry.device}/${entry.name}`;
}
function displayTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}
function entryDetails(entry: RemoteBackup): string {
  const source = entry.device === status.value?.device ? t("webdavThisProfile") : entry.device.slice(0, 8);
  const kind = t(entry.kind === "auto" ? "webdavAuto" : "webdavManual");
  return `${kind} · ${source}${entry.bytes === null ? "" : ` · ${sizeLabel(entry.bytes)} MiB`}`;
}
function entryLabel(entry: RemoteBackup): string {
  return `${displayTime(entry.createdAt)} · ${entryDetails(entry)}`;
}
function errorText(code: string): string {
  if (errors[code]) return t(errors[code]);
  if (code.startsWith("WEBDAV_HTTP_")) return t("webdavHttpError", { code: code.slice("WEBDAV_HTTP_".length) });
  return t(code.startsWith("WEBDAV_") ? "webdavFailed" : backupErrorKey(new Error(code)));
}
async function refreshUsage(): Promise<void> {
  const result = await remote.webdavStatus().catch(() => null);
  if (result) status.value = result.status;
}
async function withBudget<T>(request: (override: boolean) => Promise<T>): Promise<T | null> {
  try { return await request(false); }
  catch (problem) {
    if (!(problem instanceof Error) || problem.message !== "WEBDAV_BUDGET") throw problem;
    await refreshUsage();
    const bytes = isRecord(problem) && typeof problem.bytes === "number" ? problem.bytes : 0;
    const confirmed = await props.dialog.confirm({
      title: t("webdavBudgetReached"), message: t(bytes ? "webdavBudgetConfirmEstimate" : "webdavBudgetConfirm", { size: sizeLabel(bytes) })
    });
    return confirmed ? request(true) : null;
  }
}
async function perform(action: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  note.value = "";
  try { await action(); }
  catch (problem) {
    error.value = errorText(problem instanceof Error ? problem.message : "WEBDAV_FAILED");
    await refreshUsage();
  }
  finally { busy.value = false; }
}
async function save(): Promise<void> {
  await perform(async () => {
    const { status: saved } = draftOrigin.value
      ? await remote.applyWebdavPreset(selectPreset(form), password.value, testToken.value)
      : await remote.saveWebdav({ ...form }, password.value);
    status.value = saved;
    Object.assign(form, saved.options);
    password.value = "";
    draftOrigin.value = undefined;
    entries.value = [];
    loadedList.value = false;
    note.value = t("webdavSaved");
  });
}
async function refreshPreset(): Promise<void> {
  try { sync.value = (await configureSync({ action: "status" })).status; }
  catch { /* The local connection remains usable if sync is unavailable. */ }
}
function openDraft(): void {
  const preset = sync.value?.preset;
  if (!preset || !status.value) return;
  draftOrigin.value = preset;
  Object.assign(form, status.value.options, preset);
  password.value = "";
  testToken.value = "";
  note.value = "";
  error.value = "";
  if (configDetails.value) configDetails.value.open = true;
}
function cancelDraft(): void {
  Object.assign(form, activeSettings.value ?? DEFAULT_BACKUP_OPTIONS);
  password.value = "";
  draftOrigin.value = undefined;
  testToken.value = "";
  note.value = "";
  error.value = "";
}
async function testConnection(): Promise<void> {
  await perform(async () => {
    const result = await withBudget(remote.testWebdav);
    if (!result) return;
    status.value = result.status;
    note.value = t("webdavConnected");
  });
}
async function testDraft(): Promise<void> {
  if (!configForm.value?.reportValidity()) return;
  await perform(async () => {
    testToken.value = "";
    const result = await withBudget(override => remote.testWebdavPreset(selectPreset(form), password.value, override));
    if (!result) return;
    status.value = result.status;
    testToken.value = result.token;
    note.value = t("webdavPresetTested");
  });
}
async function refresh(): Promise<void> {
  await perform(async () => {
    const result = await withBudget(remote.listWebdav);
    if (!result) return;
    status.value = result.status;
    entries.value = result.entries;
    loadedList.value = true;
  });
}
async function upload(): Promise<void> {
  await perform(async () => {
    const result = await withBudget(override => remote.uploadWebdav(manualImages.value, override));
    if (!result) return;
    status.value = result.status;
    note.value = t("webdavUploaded");
  });
}
async function download(entry: RemoteBackup): Promise<void> {
  await perform(async () => {
    const result = await withBudget(override => remote.downloadWebdav(entry, override));
    if (!result) return;
    status.value = result.status;
    saveDownload(result.archive, entry.name);
    if (result.imageDamage) note.value = t("backupImageDamage", { ...result.imageDamage });
  });
}
async function restore(entry: RemoteBackup): Promise<void> {
  const mode = restoreMode.value;
  await perform(async () => {
    const result = await withBudget(override => remote.loadWebdavRestore(entry, override));
    if (!result) return;
    status.value = result.status;
    const options = { keepRecovery: true, imageDamage: result.imageDamage };
    if (await restoreBackup(result.payload, mode, props.dialog, options) && mode === "replace") hasRecovery.value = true;
  });
}
async function remove(entry: RemoteBackup): Promise<void> {
  await perform(async () => {
    if (!await props.dialog.confirm({ tone: "danger", title: t("webdavDeleteTitle"), message: entryLabel(entry), confirmText: t("delete") })) return;
    const result = await withBudget(override => remote.deleteWebdav(entry, override));
    if (!result) return;
    status.value = result.status;
    entries.value = entries.value.filter(candidate => entryKey(candidate) !== entryKey(entry));
  });
}
async function downloadRecovery(): Promise<void> {
  await perform(async () => {
    const { payload } = await recoveryBackup();
    if (!payload) return;
    saveBackupFile(payload, `stayside-recovery-${payload.exportedAt.replaceAll(":", "-")}.json`, true);
  });
}

async function loadStatus(): Promise<void> {
  error.value = "";
  try {
    const { status: saved } = await remote.webdavStatus();
    Object.assign(form, saved.options);
    manualImages.value = saved.options.includeImages;
    status.value = saved;
    if ((await recoveryStatus()).available) hasRecovery.value = true;
  } catch (problem) {
    error.value = errorText(problem instanceof Error ? problem.message : "WEBDAV_FAILED");
  }
}

watch(() => [form.endpoint, form.directory, form.username, form.intervalHours, form.includeImages, password.value], () => {
  if (testToken.value) { testToken.value = ""; note.value = ""; }
});
onMounted(() => { stopSync = watchSync(refreshPreset); void refreshPreset(); void loadStatus(); });
onUnmounted(() => stopSync?.());
</script>

<template>
  <section class="webdav-backup" aria-labelledby="webdav-backup-title">
    <div class="webdav-overview">
      <div class="webdav-status">
        <h3 id="webdav-backup-title" class="backup-subsection-title">{{ t('webdavTitle') }}</h3>
        <template v-if="status?.configured">
          <p class="setting-note">{{ status.lastBackup === null ? t('webdavNeverBackedUp') : t('webdavLastBackup', { time: displayTime(status.lastBackup) }) }}</p>
          <p class="setting-note">{{ t('webdavUsage', { used, total: status.options.budgetMiB, requests: status.usage.requests }) }}</p>
          <p v-if="uncertainUpload" class="setting-note">{{ t('webdavUnconfirmedUploads', { size: uncertainUpload }) }}</p>
          <p v-if="status.lastError" class="webdav-error" role="status">{{ errorText(status.lastError) }}</p>
          <p v-if="status.cleanupPending" class="setting-note" role="status">{{ t('webdavCleanupPending') }}</p>
        </template>
      </div>
      <div v-if="status?.configured" class="data-actions">
        <div class="export-actions">
          <button class="setting-action" type="button" :disabled="!onlineActions" @click="upload">{{ t('webdavBackupNow') }}</button>
          <button class="setting-action" type="button" :disabled="!onlineActions" @click="refresh">{{ t(loadedList ? 'webdavRefreshList' : 'webdavList') }}</button>
        </div>
        <label class="export-images"><input v-model="manualImages" type="checkbox" :disabled="busy" /><span>{{ t('backupIncludeImages') }}</span></label>
      </div>
    </div>
    <div v-if="status && draftAvailable" class="import-actions">
      <p class="setting-note" role="status">{{ t(draftOrigin ? 'webdavPresetUpdated' : 'webdavPresetReceived') }}</p>
      <button class="setting-action" type="button" :disabled="busy" @click="openDraft">{{ t(draftOrigin ? 'webdavPresetOpenNew' : 'webdavPresetOpen') }}</button>
    </div>
    <details v-if="status" ref="configDetails" class="webdav-config">
      <summary>{{ t(status.configured ? 'webdavConnectionSettings' : 'webdavConfigure') }}</summary>
      <p v-if="draftOrigin" class="setting-note" role="status">{{ t('webdavPresetDraft') }}</p>
      <form ref="configForm" class="webdav-form" @submit.prevent="save">
        <label><span>{{ t('webdavEndpoint') }}</span><input v-model="form.endpoint" type="url" required placeholder="https://…" :disabled="busy" /></label>
        <label><span>{{ t('webdavDirectory') }}</span><input v-model="form.directory" type="text" required :disabled="busy" /></label>
        <label><span>{{ t('webdavUsername') }}</span><input v-model="form.username" type="text" required autocomplete="username" :disabled="busy" /></label>
        <label><span>{{ t('webdavPassword') }}</span><input v-model="password" type="password" autocomplete="off" :required="needsPassword" :placeholder="needsPassword ? '' : t('webdavPasswordSaved')" :disabled="busy" /></label>
        <label><span>{{ t('webdavHours') }}</span><input v-model.number="form.intervalHours" type="number" min="1" max="720" step="1" required :disabled="busy" /></label>
        <label v-if="!draftOrigin"><span>{{ t('webdavBudget') }}</span><input v-model.number="form.budgetMiB" type="number" min="1" max="100000" step="1" required :disabled="busy" /></label>
        <div class="export-actions webdav-wide">
          <label v-if="!draftOrigin" class="export-images"><input v-model="form.automatic" type="checkbox" :disabled="busy" /><span>{{ t('webdavEnableAuto') }}</span></label>
          <label class="export-images"><input v-model="form.includeImages" type="checkbox" :disabled="busy" /><span>{{ t('webdavAutoImages') }}</span></label>
        </div>
        <div class="import-actions webdav-wide">
          <template v-if="draftOrigin">
            <button class="setting-action" type="button" :disabled="busy || !sync?.sharePreset" @click="testDraft">{{ t('webdavTest') }}</button>
            <button class="setting-action" type="submit" :disabled="busy || !testToken || !sync?.sharePreset">{{ t('webdavPresetApply') }}</button>
            <button class="setting-action" type="button" :disabled="busy" @click="cancelDraft">{{ t('cancel') }}</button>
          </template>
          <template v-else>
            <button class="setting-action" type="submit" :disabled="busy || !dirty">{{ t('webdavSave') }}</button>
            <button class="setting-action" type="button" :disabled="!onlineActions" @click="testConnection">{{ t('webdavTest') }}</button>
          </template>
        </div>
      </form>
    </details>
    <p v-if="status?.configured && dirty && !draftOrigin" class="setting-note">{{ t('webdavUnsaved') }}</p>
    <p v-if="error" class="webdav-error" role="alert">{{ error }}</p>
    <button v-if="error && !status" class="setting-action webdav-local-action" type="button" @click="loadStatus">{{ t('retry') }}</button>
    <p v-if="note" class="setting-note" role="status">{{ note }}</p>
    <div v-if="loadedList" class="webdav-operations">
      <p v-if="!entries.length" class="setting-note" role="status">{{ t('webdavNoBackups') }}</p>
      <template v-else>
        <div class="webdav-list-header">
          <h4 id="webdav-remote-backups-heading">{{ t('webdavBackupList') }}</h4>
          <label class="webdav-restore-mode">
            {{ t('webdavRestoreMode') }}
            <select v-model="restoreMode" class="setting-select" :disabled="busy">
              <option value="merge">{{ t('backupMergeMode') }}</option>
              <option value="replace">{{ t('backupReplaceMode') }}</option>
            </select>
          </label>
        </div>
        <ul class="webdav-file-list" aria-labelledby="webdav-remote-backups-heading">
          <li v-for="entry in entries" :key="entryKey(entry)" class="webdav-file-row">
            <div class="webdav-file-copy">
              <span class="webdav-file-time">{{ displayTime(entry.createdAt) }}</span>
              <span class="webdav-file-details">{{ entryDetails(entry) }}</span>
            </div>
            <div class="webdav-file-actions" role="group" :aria-label="entryLabel(entry)">
              <button class="setting-action" type="button" :disabled="!onlineActions" @click="restore(entry)">{{ t('webdavRestore') }}</button>
              <button class="setting-action" type="button" :disabled="!onlineActions" @click="download(entry)">{{ t('webdavDownload') }}</button>
              <button class="setting-action danger" type="button" :disabled="!onlineActions" @click="remove(entry)">{{ t('delete') }}</button>
            </div>
          </li>
        </ul>
      </template>
    </div>
    <button v-if="hasRecovery" class="setting-action webdav-local-action" type="button" :disabled="busy" @click="downloadRecovery">{{ t('webdavRecovery') }}</button>
  </section>
</template>

<style scoped>
.webdav-backup { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; border-top: 1px solid var(--hairline); padding: 14px 0 4px; }
.webdav-overview { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 24px; }
.webdav-status { min-width: 0; }
.webdav-status > h3 { margin-bottom: 4px; }
.webdav-backup :is(.setting-note, .webdav-error) { margin: 0; }
.webdav-config > summary { width: fit-content; padding: 6px 0; cursor: pointer; font-size: 13px; font-weight: 650; }
.webdav-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; padding: 10px 0; }
.webdav-form > label { display: grid; gap: 5px; color: var(--muted); font-size: 13px; }
.webdav-form > label > input {
  min-width: 0; border: 1px solid var(--hairline-2); border-radius: 12px; padding: 9px 12px;
  background: var(--field); color: var(--field-text); font: inherit;
}
.webdav-form > label > input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.webdav-wide { grid-column: 1 / -1; }
.webdav-error { color: var(--danger); font-size: 13px; }
.webdav-operations { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; border-top: 1px solid var(--hairline); padding-top: 12px; }
.webdav-list-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; }
.webdav-list-header > h4 { margin: 0; color: var(--ink); font-size: 13px; font-weight: 650; }
.webdav-restore-mode { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: var(--field-text); font-size: 13px; }
.webdav-restore-mode > select { max-inline-size: 100%; }
.webdav-file-list {
  max-block-size: 24rem; overflow-y: auto; margin: 0; padding: 0; list-style: none;
  border: 1px solid var(--hairline-2); border-radius: 12px; background: var(--field);
}
.webdav-file-list > li + li { border-top: 1px solid var(--hairline); }
.webdav-file-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 8px 12px; }
.webdav-file-copy { display: grid; flex: 1 1 12rem; min-width: 0; gap: 2px; overflow-wrap: anywhere; }
.webdav-file-time { color: var(--ink); font-size: 13px; font-weight: 650; font-variant-numeric: tabular-nums; }
.webdav-file-details { color: var(--field-text); font-size: 12px; }
.webdav-file-actions { display: flex; flex-wrap: wrap; gap: 6px; max-inline-size: 100%; }
.webdav-file-actions > .setting-action { min-block-size: 44px; min-inline-size: 44px; padding: 6px 10px; border-radius: 8px; font-size: 12px; }
.webdav-file-actions > .danger:not(:hover) { border-color: transparent; background: transparent; }
.webdav-local-action { justify-self: start; }
@media (max-width: 550px) { .webdav-form { grid-template-columns: minmax(0, 1fr); } }
</style>
