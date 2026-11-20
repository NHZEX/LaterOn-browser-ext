import { browser } from "wxt/browser";
import type { Browser } from "wxt/browser";
import { PRESET_KEY, SYNC_MESSAGE, SYNC_STATE } from "./sync-shared";
import type { SyncReply } from "./sync-shared";

type SyncAction =
  | { readonly action: "status" | "disable" | "retry" }
  | { readonly action: "enable"; readonly choice?: "local" | "synced"; readonly revision?: string }
  | { readonly action: "preset"; readonly enabled: boolean };

export async function configureSync(action: SyncAction): Promise<Extract<SyncReply, { ok: true }>> {
  const message = { type: SYNC_MESSAGE, ...action };
  const response = await browser.runtime.sendMessage<typeof message, SyncReply | undefined>(message);
  if (!response?.ok) throw new Error("CONFIGURATION_SYNC");
  return response;
}

export function watchSync(callback: () => void): () => void {
  const changed = (changes: Record<string, Browser.storage.StorageChange>, area: string) => {
    if ((area === "local" && changes[SYNC_STATE]) || (area === "sync" && changes[PRESET_KEY])) callback();
  };
  browser.storage.onChanged.addListener(changed);
  return () => browser.storage.onChanged.removeListener?.(changed);
}
