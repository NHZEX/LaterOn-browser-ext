export const SYNC_ACCEPTANCE_BUILD = import.meta.env?.MODE === "sync-acceptance";
export const SYNC_ACCEPTANCE_MESSAGE = "LATERON_SYNC_ACCEPTANCE";
export const SYNC_META = "laterOnSyncMeta";
export type SyncAcceptanceStatus = "unbound" | "ready" | "pending" | "joined" | "verified";
export type SyncAcceptanceAction = "status" | "create" | "publish" | "preview" | "join" | "sync" | "unbind";
export interface SyncJoinPreview {
  readonly proof: string;
  readonly local: number;
  readonly incoming: number;
  readonly collectionId: string;
}
export type SyncAcceptanceReply = { readonly ok: true; readonly status: SyncAcceptanceStatus;
  readonly collectionId?: string; readonly preview?: SyncJoinPreview } | { readonly ok: false };
