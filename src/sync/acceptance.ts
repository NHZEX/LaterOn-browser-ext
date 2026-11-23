export const SYNC_ACCEPTANCE_BUILD = import.meta.env?.MODE === "sync-acceptance";
export const SYNC_ACCEPTANCE_MESSAGE = "LATERON_SYNC_ACCEPTANCE";
export const SYNC_META = "laterOnSyncMeta";
export function normalizeSyncDirectory(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value.trim());
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(loopback && url.protocol === "http:")) || url.username || url.password
      || url.search || url.hash || !url.pathname.split("/").some(Boolean) || /[?#]/.test(url.href)) return;
    return url.href.endsWith("/") ? url.href : `${url.href}/`;
  } catch { return; }
}

export const QUALIFIED_SYNC_DIRECTORY = normalizeSyncDirectory(import.meta.env?.VITE_LATERON_SYNC_TRIAL_DIRECTORY);
export const syncEnabled = (meta?: { readonly trialEnabled?: true }): boolean => SYNC_ACCEPTANCE_BUILD || meta?.trialEnabled === true;
export type SyncAcceptanceStatus = "disabled" | "unbound" | "ready" | "pending" | "joined" | "verified" | "paused";
export type SyncAcceptanceAction = "status" | "enable" | "disable" | "create" | "publish" | "preview" | "join" | "sync" | "unbind";
export interface SyncJoinPreview {
  readonly proof: string;
  readonly local: number;
  readonly incoming: number;
  readonly removed: number;
  readonly collectionId: string;
}
export type SyncAcceptanceReply = { readonly ok: true; readonly status: SyncAcceptanceStatus;
  readonly collectionId?: string; readonly preview?: SyncJoinPreview; readonly moreChanges?: boolean } | { readonly ok: false };
