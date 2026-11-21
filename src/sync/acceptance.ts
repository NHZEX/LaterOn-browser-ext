export const SYNC_ACCEPTANCE_BUILD = import.meta.env?.MODE === "sync-acceptance";
export const SYNC_ACCEPTANCE_MESSAGE = "LATERON_SYNC_ACCEPTANCE";
export type SyncAcceptanceStatus = "unbound" | "ready" | "pending" | "verified";
export type SyncAcceptanceAction = "status" | "create" | "publish";
export type SyncAcceptanceReply = { readonly ok: true; readonly status: SyncAcceptanceStatus } | { readonly ok: false };
