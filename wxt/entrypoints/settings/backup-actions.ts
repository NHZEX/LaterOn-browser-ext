import { applyBackup, clearPanelCache, previewBackup } from "../../../src/backup/client";
import { MAX_BYTES } from "../../../src/backup/core";
import { t } from "../../../src/shared/i18n";
import type { BackupImageDamage } from "../../../src/backup/archive-images";
import type { ImportMode } from "../../../src/backup/client";
import type { BackupDocument } from "../../../src/backup/core";
import type { SettingsDialog } from "./useDialog";

export function saveBackupFile(payload: BackupDocument, filename: string, compact = false): void {
  const blob = new Blob([JSON.stringify(payload, null, compact ? 0 : 2)], { type: "application/json" });
  if (blob.size > MAX_BYTES) throw new Error("BACKUP_TOO_LARGE");
  saveDownload(blob, filename);
}

export function saveDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
  } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

export interface RestoreOptions {
  readonly keepRecovery?: boolean;
  readonly imageDamage?: BackupImageDamage;
}

export async function restoreBackup(
  payload: unknown, mode: ImportMode, dialog: SettingsDialog, { keepRecovery = false, imageDamage }: RestoreOptions = {}
): Promise<boolean> {
  const preview = await previewBackup(payload, mode);
  const counts = t("backupCounts", { ...preview.incoming });
  const details = mode === "replace"
    ? t(keepRecovery ? "webdavReplacePreview" : "backupReplacePreview", { items: preview.current.items, projects: preview.current.projects })
    : t("backupMergePreview", { added: preview.added, projects: preview.addedProjects, duplicates: preview.duplicates });
  const message = [counts, details, t("backupPreferencesKept")];
  if (imageDamage) message.push(t("backupImageDamage", { ...imageDamage }));
  const confirmKey = mode === "replace"
    ? (imageDamage ? "backupReplaceWithoutImages" : "backupReplaceConfirm")
    : (imageDamage ? "backupMergeWithoutImages" : "backupMergeConfirm");
  const confirmed = await dialog.confirm({
    tone: mode === "replace" || imageDamage ? "danger" : "question",
    title: t(mode === "replace" ? "backupReplaceTitle" : "backupMergeTitle"),
    message: message.join("\n"),
    confirmText: t(confirmKey)
  });
  if (!confirmed) return false;
  const result = await applyBackup(payload, mode, preview.token, keepRecovery);
  clearPanelCache();
  await dialog.alert({ tone: "success", title: t("importDoneTitle"), message: t(mode === "replace" ? "backupReplaceDone" : "backupMergeDone", { ...result }) });
  return true;
}
