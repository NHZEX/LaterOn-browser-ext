import { browser } from "wxt/browser";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { createStorageClient } from "../../src/storage/client";
import { EPOCH } from "../../src/storage/contracts";
import type { StorageClient } from "../../src/storage/client";
import type { CollectionCommandResult } from "../../src/storage/contracts";

declare global {
  var LaterOnStorage: Pick<StorageClient, "initialize" | "run"> & {
    setFailureHandler(handler: (code: string) => Promise<void>): () => void;
  };
  var showToast: ((message: string) => void) | undefined;
}

function reloadLibrary(): void {
  if (/\/(library|sidepanel)\.html$/.test(location.pathname)) location.reload();
}

export default defineUnlistedScript(() => {
  let failure: ((code: string) => Promise<void>) | undefined;
  const client = createStorageClient({
    sendMessage: (message) => browser.runtime.sendMessage<Readonly<Record<string, unknown>>, CollectionCommandResult | undefined>(message),
    onInvalidated: () => {
      try { localStorage.removeItem("laterOnPanelCache"); } catch { /* Optional cache. */ }
      reloadLibrary();
    },
    onFailure: async code => {
      await failure?.(code);
      if (code === "STALE_COLLECTION") reloadLibrary();
    }
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[EPOCH]) client.invalidate();
  });
  globalThis.LaterOnStorage = { initialize: client.initialize, run: client.run,
    setFailureHandler(handler) {
      failure = handler;
      return () => { if (failure === handler) failure = undefined; };
    }
  };
});
