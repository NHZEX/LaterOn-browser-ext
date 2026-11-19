<script setup lang="ts">
import { ref, shallowRef } from "vue";
import { exportBackup } from "../../../src/backup/client";
import { MAX_BYTES } from "../../../src/backup/core";
import { MAX_ARCHIVE_BYTES, readBackupArchive } from "../../../src/backup/webdav-archive";
import { t } from "../../../src/shared/i18n";
import { backupErrorKey } from "./shared";
import { restoreBackup, saveBackupFile } from "./backup-actions";
import WebdavBackupPanel from "./WebdavBackupPanel.vue";
import type { ImportMode } from "../../../src/backup/client";
import type { SettingsDialog } from "./useDialog";

const props = defineProps<{ dialog: SettingsDialog }>();

const busy = defineModel<boolean>("busy", { default: false });
const includeImages = ref(false);
const mode = ref<ImportMode>("merge");
const fileInput = shallowRef<HTMLInputElement | null>(null);

function failure(error: unknown, title: string): Promise<void> {
  return props.dialog.alert({ tone: "danger", title: t(title), message: t(backupErrorKey(error)) });
}
function chooseFile(): void { fileInput.value?.click(); }
async function download(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    const { payload } = await exportBackup(includeImages.value);
    saveBackupFile(payload, `stayside-backup-${payload.exportedAt.replace(/[:.]/g, "-")}.json`);
  } catch (error) { await failure(error, "backupExportFail"); }
  finally { busy.value = false; }
}
async function importFile(): Promise<void> {
  const input = fileInput.value;
  const file = input?.files?.[0];
  if (!input || !file || busy.value) return;
  const importMode = mode.value;
  busy.value = true;
  try {
    await restoreBackup(await readBackupFile(file), importMode, props.dialog);
  } catch (error) { await failure(error, "importFailTitle"); }
  finally { input.value = ""; busy.value = false; }
}

async function readBackupFile(file: File): Promise<unknown> {
  if (/\.zip$/i.test(file.name)) {
    if (file.size > MAX_ARCHIVE_BYTES) throw new Error("BACKUP_TOO_LARGE");
    return readBackupArchive(new Uint8Array(await file.arrayBuffer()));
  }
  if (file.size > MAX_BYTES) throw new Error("BACKUP_TOO_LARGE");
  try { return JSON.parse((await file.text()).replace(/^\uFEFF/, "")); }
  catch { throw new Error("INVALID_BACKUP:json"); }
}
</script>

<template>
  <section class="settings-group" aria-labelledby="backup-restore-title" :aria-busy="busy">
    <h2 id="backup-restore-title">{{ t('backupRestore') }}</h2>
    <section class="setting-row" aria-labelledby="local-backup-title">
      <div class="setting-label">
        <h3 id="local-backup-title" class="backup-subsection-title">{{ t('backupLocalFiles') }}</h3>
        <span>{{ t('backupHint') }}</span>
      </div>
      <div class="data-actions">
        <div class="export-actions">
          <button id="exportBtn" class="setting-action" type="button" :disabled="busy" @click="download">{{ t('export') }}</button>
          <label class="export-images"><input id="exportImages" v-model="includeImages" type="checkbox" :disabled="busy" /><span>{{ t('backupIncludeImages') }}</span></label>
        </div>
        <div class="import-actions">
          <select id="importMode" v-model="mode" class="setting-select" :aria-label="t('backupImportMode')" :disabled="busy">
            <option value="merge">{{ t('backupMergeMode') }}</option>
            <option value="replace">{{ t('backupReplaceMode') }}</option>
          </select>
          <button id="importBtn" class="setting-action" type="button" :disabled="busy" @click="chooseFile">{{ t('import') }}</button>
        </div>
        <input id="importFile" ref="fileInput" type="file" accept="application/json,application/zip,.json,.zip" hidden @change="importFile" />
      </div>
    </section>
    <WebdavBackupPanel v-model:busy="busy" :dialog="dialog" />
  </section>
</template>
