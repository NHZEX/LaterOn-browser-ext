<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef } from "vue";
import { recoveryBackup, recoveryStatus } from "../../../src/backup/client";
import * as remote from "../../../src/backup/webdav-client";
import { DEFAULT_BACKUP_OPTIONS, MIB } from "../../../src/backup/webdav-shared";
import { isRecord } from "../../../src/storage/contracts";
import { t } from "../../../src/shared/i18n";
import { restoreBackup, saveBackupFile, saveDownload } from "./backup-actions";
import { backupErrorKey } from "./shared";
import type { ImportMode } from "../../../src/backup/client";
import type { BackupOptions, BackupStatus, RemoteBackup } from "../../../src/backup/webdav-shared";
import type { SettingsDialog } from "./useDialog";

const props = defineProps<{ dialog: SettingsDialog }>();
const busy = defineModel<boolean>("busy", { default: false });
const hasRecovery = defineModel<boolean>("hasRecovery", { required: true });
const status = shallowRef<BackupStatus | null>(null);
const form = reactive({ ...DEFAULT_BACKUP_OPTIONS });
const password = ref("");
const entries = shallowRef<readonly RemoteBackup[]>([]);
const loadedList = ref(false);
const selectedKey = ref("");
const restoreMode = ref<ImportMode>("merge");
const manualImages = ref(false);
const note = ref("");
const error = ref("");
const activeSettings = computed(() => status.value?.options);
const dirty = computed(() => !!password.value || (Object.keys(form) as (keyof BackupOptions)[])
  .some(key => form[key] !== activeSettings.value?.[key]));
const onlineActions = computed(() => status.value?.configured === true && !dirty.value && !busy.value);
const selected = computed(() => entries.value.find(entry => entryKey(entry) === selectedKey.value));
const used = computed(() => status.value ? sizeLabel(status.value.usage.uploaded + status.value.usage.downloaded) : "0");
const errors: Readonly<Record<string, string>> = {
  WEBDAV_SETTINGS: "webdavInvalidSettings", WEBDAV_NETWORK: "webdavNetwork",
  WEBDAV_HTTP_401: "webdavUnauthorized", WEBDAV_HTTP_403: "webdavForbidden", WEBDAV_HTTP_404: "webdavMissing",
  WEBDAV_DIRECTORY: "webdavDirectoryError", WEBDAV_BUDGET: "webdavBudgetReached", WEBDAV_LIST_LIMIT: "webdavListTooLong",
  WEBDAV_INVALID_BACKUP: "webdavInvalidArchive"
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
function entryLabel(entry: RemoteBackup): string {
  const source = entry.device === status.value?.device ? t("webdavThisProfile") : entry.device.slice(0, 8);
  const kind = t(entry.kind === "auto" ? "webdavAuto" : "webdavManual");
  return `${displayTime(entry.createdAt)} · ${kind} · ${source}${entry.bytes === null ? "" : ` · ${sizeLabel(entry.bytes)} MiB`}`;
}
function errorText(code: string): string {
  if (errors[code]) return t(errors[code]);
  if (code.startsWith("WEBDAV_HTTP_")) return t("webdavHttpError", { code: code.slice("WEBDAV_HTTP_".length) });
  return t(code.startsWith("WEBDAV_") ? "webdavFailed" : backupErrorKey(new Error(code)));
}
async function withBudget<T>(request: (override: boolean) => Promise<T>): Promise<T | null> {
  try { return await request(false); }
  catch (problem) {
    if (!(problem instanceof Error) || problem.message !== "WEBDAV_BUDGET") throw problem;
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
  catch (problem) { error.value = errorText(problem instanceof Error ? problem.message : "WEBDAV_FAILED"); }
  finally { busy.value = false; }
}
async function save(): Promise<void> {
  await perform(async () => {
    const { status: saved } = await remote.saveWebdav({ ...form }, password.value);
    status.value = saved;
    Object.assign(form, saved.options);
    password.value = "";
    entries.value = [];
    loadedList.value = false;
    selectedKey.value = "";
    note.value = t("webdavSaved");
  });
}
async function testConnection(): Promise<void> {
  await perform(async () => {
    const result = await withBudget(remote.testWebdav);
    if (!result) return;
    status.value = result.status;
    note.value = t("webdavConnected");
  });
}
async function refresh(): Promise<void> {
  await perform(async () => {
    const result = await withBudget(remote.listWebdav);
    if (!result) return;
    status.value = result.status;
    entries.value = result.entries;
    loadedList.value = true;
    if (!selected.value) selectedKey.value = result.entries[0] ? entryKey(result.entries[0]) : "";
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
async function download(): Promise<void> {
  const entry = selected.value;
  if (!entry) return;
  await perform(async () => {
    const result = await withBudget(override => remote.downloadWebdav(entry, override));
    if (!result) return;
    status.value = result.status;
    saveDownload(result.archive, entry.name);
    if (result.imageDamage) note.value = t("backupImageDamage", { ...result.imageDamage });
  });
}
async function restore(): Promise<void> {
  const entry = selected.value;
  const mode = restoreMode.value;
  if (!entry) return;
  await perform(async () => {
    const result = await withBudget(override => remote.loadWebdavRestore(entry, override));
    if (!result) return;
    status.value = result.status;
    const options = { keepRecovery: true, imageDamage: result.imageDamage };
    if (await restoreBackup(result.payload, mode, props.dialog, options) && mode === "replace") hasRecovery.value = true;
  });
}
async function remove(): Promise<void> {
  const entry = selected.value;
  if (!entry) return;
  await perform(async () => {
    if (!await props.dialog.confirm({ tone: "danger", title: t("webdavDeleteTitle"), message: entryLabel(entry), confirmText: t("delete") })) return;
    const result = await withBudget(override => remote.deleteWebdav(entry, override));
    if (!result) return;
    status.value = result.status;
    entries.value = entries.value.filter(candidate => entryKey(candidate) !== entryKey(entry));
    selectedKey.value = entries.value[0] ? entryKey(entries.value[0]) : "";
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

onMounted(loadStatus);
</script>

<template>
  <section class="webdav-backup" aria-labelledby="webdav-backup-title">
    <div class="webdav-overview">
      <div class="webdav-status">
        <h3 id="webdav-backup-title" class="backup-subsection-title">{{ t('webdavTitle') }}</h3>
        <template v-if="status?.configured">
          <p class="setting-note">{{ status.lastBackup === null ? t('webdavNeverBackedUp') : t('webdavLastBackup', { time: displayTime(status.lastBackup) }) }}</p>
          <p class="setting-note">{{ t('webdavUsage', { used, total: status.options.budgetMiB, requests: status.usage.requests }) }}</p>
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
    <details v-if="status" class="webdav-config">
      <summary>{{ t(status.configured ? 'webdavConnectionSettings' : 'webdavConfigure') }}</summary>
      <form class="webdav-form" @submit.prevent="save">
        <label><span>{{ t('webdavEndpoint') }}</span><input v-model="form.endpoint" type="url" required placeholder="https://…" :disabled="busy" /></label>
        <label><span>{{ t('webdavDirectory') }}</span><input v-model="form.directory" type="text" required :disabled="busy" /></label>
        <label><span>{{ t('webdavUsername') }}</span><input v-model="form.username" type="text" required autocomplete="username" :disabled="busy" /></label>
        <label><span>{{ t('webdavPassword') }}</span><input v-model="password" type="password" autocomplete="off" :required="!status.configured" :placeholder="status.configured ? t('webdavPasswordSaved') : ''" :disabled="busy" /></label>
        <label><span>{{ t('webdavHours') }}</span><input v-model.number="form.intervalHours" type="number" min="1" max="720" step="1" required :disabled="busy" /></label>
        <label><span>{{ t('webdavBudget') }}</span><input v-model.number="form.budgetMiB" type="number" min="1" max="100000" step="1" required :disabled="busy" /></label>
        <div class="export-actions webdav-wide">
          <label class="export-images"><input v-model="form.automatic" type="checkbox" :disabled="busy" /><span>{{ t('webdavEnableAuto') }}</span></label>
          <label class="export-images"><input v-model="form.includeImages" type="checkbox" :disabled="busy" /><span>{{ t('webdavAutoImages') }}</span></label>
        </div>
        <div class="import-actions webdav-wide">
          <button class="setting-action" type="submit" :disabled="busy || !dirty">{{ t('webdavSave') }}</button>
          <button class="setting-action" type="button" :disabled="!onlineActions" @click="testConnection">{{ t('webdavTest') }}</button>
        </div>
      </form>
    </details>
    <p v-if="status?.configured && dirty" class="setting-note">{{ t('webdavUnsaved') }}</p>
    <p v-if="error" class="webdav-error" role="alert">{{ error }}</p>
    <button v-if="error && !status" class="setting-action webdav-local-action" type="button" @click="loadStatus">{{ t('retry') }}</button>
    <p v-if="note" class="setting-note" role="status">{{ note }}</p>
    <div v-if="loadedList" class="webdav-operations">
      <p v-if="!entries.length" class="setting-note" role="status">{{ t('webdavNoBackups') }}</p>
      <template v-else>
        <select v-model="selectedKey" class="setting-select webdav-files" :aria-label="t('webdavSelect')" :disabled="busy">
          <option v-for="entry in entries" :key="entryKey(entry)" :value="entryKey(entry)">{{ entryLabel(entry) }}</option>
        </select>
        <div class="import-actions">
          <select v-model="restoreMode" class="setting-select" :aria-label="t('backupImportMode')" :disabled="busy">
            <option value="merge">{{ t('backupMergeMode') }}</option>
            <option value="replace">{{ t('backupReplaceMode') }}</option>
          </select>
          <button class="setting-action" type="button" :disabled="!onlineActions || !selected" @click="restore">{{ t('webdavRestore') }}</button>
          <button class="setting-action" type="button" :disabled="!onlineActions || !selected" @click="download">{{ t('webdavDownload') }}</button>
          <button class="setting-action danger" type="button" :disabled="!onlineActions || !selected" @click="remove">{{ t('delete') }}</button>
        </div>
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
.webdav-files { min-width: 0; max-width: 100%; }
.webdav-local-action { justify-self: start; }
@media (max-width: 550px) { .webdav-form { grid-template-columns: minmax(0, 1fr); } }
</style>
