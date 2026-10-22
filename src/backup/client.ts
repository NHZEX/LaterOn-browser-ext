import { browser } from "wxt/browser";
import type { BackupCounts, BackupDocument } from "./core";

export type ImportMode = "merge" | "replace";
export interface ImportToken {
  readonly revision: string;
  readonly createdAt: number;
}
export interface ImportPreview {
  readonly token: ImportToken;
  readonly incoming: BackupCounts;
  readonly current: BackupCounts;
  readonly added: number;
  readonly addedProjects: number;
  readonly duplicates: number;
}
export interface ImportResult {
  readonly total: number;
  readonly added: number;
  readonly addedProjects: number;
  readonly duplicates: number;
}

// The background remains responsible for validating file contents and import revisions.
async function request<T extends object>(message: Readonly<Record<string, unknown>>): Promise<T> {
  const response = await browser.runtime.sendMessage<Readonly<Record<string, unknown>>,
    (T & { readonly ok: true }) | { readonly ok: false; readonly error: string } | undefined>(message);
  if (!response?.ok) throw new Error(response?.error || "BACKUP_FAILED");
  return response;
}

export const exportBackup = (includeImages: boolean): Promise<{ readonly payload: BackupDocument }> =>
  request({ type: "BACKUP_EXPORT", includeImages });
export const previewBackup = (payload: unknown, mode: ImportMode): Promise<ImportPreview> =>
  request({ type: "BACKUP_PREVIEW", payload, mode });
export const applyBackup = (payload: unknown, mode: ImportMode, token: ImportToken): Promise<ImportResult> =>
  request({ type: "BACKUP_APPLY", payload, mode, token });
export const wipeCollection = (): Promise<object> => request({ type: "COLLECTION_WIPE" });

export function clearPanelCache(): void {
  try { localStorage.removeItem("laterOnPanelCache"); } catch { /* Optional cache. */ }
}
