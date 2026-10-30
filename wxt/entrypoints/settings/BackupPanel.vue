<script setup lang="ts">
import { ref, shallowRef } from "vue";
import { applyBackup, clearPanelCache, exportBackup, previewBackup } from "../../../src/backup/client";
import { MAX_BYTES } from "../../../src/backup/core";
import { t } from "../../../src/shared/i18n";
import { backupErrorKey } from "./shared";
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
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    if (blob.size > MAX_BYTES) throw new Error("BACKUP_TOO_LARGE");
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = `stayside-backup-${payload.exportedAt.replace(/[:.]/g, "-")}.json`;
      link.click();
    } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
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
    if (file.size > MAX_BYTES) throw new Error("BACKUP_TOO_LARGE");
    let payload: unknown;
    try { payload = JSON.parse((await file.text()).replace(/^\uFEFF/, "")); }
    catch { throw new Error("INVALID_BACKUP:json"); }
    const preview = await previewBackup(payload, importMode);
    const counts = t("backupCounts", { ...preview.incoming });
    const details = importMode === "replace"
      ? t("backupReplacePreview", { items: preview.current.items, projects: preview.current.projects })
      : t("backupMergePreview", { added: preview.added, projects: preview.addedProjects, duplicates: preview.duplicates });
    const confirmed = await props.dialog.confirm({
      tone: importMode === "replace" ? "danger" : "question",
      title: t(importMode === "replace" ? "backupReplaceTitle" : "backupMergeTitle"),
      message: `${counts}\n${details}\n${t("backupPreferencesKept")}`,
      confirmText: t(importMode === "replace" ? "backupReplaceConfirm" : "backupMergeConfirm")
    });
    if (!confirmed) return;
    const result = await applyBackup(payload, importMode, preview.token);
    clearPanelCache();
    await props.dialog.alert({ tone: "success", title: t("importDoneTitle"), message: t(importMode === "replace" ? "backupReplaceDone" : "backupMergeDone", { ...result }) });
  } catch (error) { await failure(error, "importFailTitle"); }
  finally { input.value = ""; busy.value = false; }
}
</script>

<template>
  <section class="settings-group" :aria-busy="busy">
    <h2>{{ t('backupRestore') }}</h2>
    <div class="setting-row">
      <div class="setting-label"><strong>{{ t('backupRestore') }}</strong><span>{{ t('backupHint') }}</span></div>
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
        <input id="importFile" ref="fileInput" type="file" accept="application/json,.json" hidden @change="importFile" />
      </div>
    </div>
  </section>
</template>
