import { browser } from "wxt/browser";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { createStorageClient } from "../../src/storage/client";
import { EPOCH } from "../../src/storage/contracts";
import type { StorageClient } from "../../src/storage/client";
import type { CollectionCommandResult } from "../../src/storage/contracts";
import type { LibraryDialog } from "../../src/library/page-adapters";

declare global {
  var LaterOnStorage: Pick<StorageClient, "initialize" | "run">;
  var LaterOnDialog: LibraryDialog | undefined;
  var showToast: ((message: string) => void) | undefined;
}

function reloadLibrary(): void {
  if (/\/(library|sidepanel)\.html$/.test(location.pathname)) location.reload();
}

async function showFailure(code: string): Promise<void> {
  const t = (key: string): string => window.LaterOnI18n?.t(key) || key;
  const message = code === "STALE_COLLECTION" ? "backupDataChanged" : code === "DUPLICATE_PROJECT_NAME" ? "duplicateProject" : "backupOperationFailed";
  if (code === "STALE_COLLECTION") {
    await window.LaterOnDialog?.alert({ tone: "danger", title: t("operationFailed"), message: t(message) });
    reloadLibrary();
  } else {
    window.showToast?.(t(message));
    const status = window.document?.querySelector("#status");
    if (status) status.textContent = t(message);
  }
}

export default defineUnlistedScript(() => {
  const client = createStorageClient({
    sendMessage: (message) => browser.runtime.sendMessage<Readonly<Record<string, unknown>>, CollectionCommandResult | undefined>(message),
    onInvalidated: () => {
      try { localStorage.removeItem("laterOnPanelCache"); } catch { /* Optional cache. */ }
      reloadLibrary();
    },
    onFailure: showFailure
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[EPOCH]) client.invalidate();
  });
  globalThis.LaterOnStorage = { initialize: client.initialize, run: client.run };
});
