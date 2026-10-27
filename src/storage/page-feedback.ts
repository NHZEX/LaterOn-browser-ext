import { t } from "../shared/i18n";
import type { DialogService } from "../ui/dialog";

// The unlisted transport must not bundle a second language state or eager dialog.
export function bindStorageFeedback(loadDialog: () => Promise<Pick<DialogService, "alert" | "close" | "dispose">>): () => void {
  let alive = true;
  let opened: Pick<DialogService, "alert" | "close" | "dispose"> | undefined;
  const stop = globalThis.LaterOnStorage.setFailureHandler(async code => {
    if (!alive) return;
    const message = code === "STALE_COLLECTION" ? "backupDataChanged"
      : code === "DUPLICATE_PROJECT_NAME" ? "duplicateProject" : "backupOperationFailed";
    if (code === "STALE_COLLECTION") {
      try {
        const api = await loadDialog();
        if (!alive) return;
        opened = api;
        const pending = api.alert({ tone: "danger", title: t("operationFailed"), message: t(message) });
        await Promise.resolve();
        if (!alive) api.close();
        await pending;
      } catch { /* Epoch rejection still reloads if the UI resource is unavailable. */ }
    } else {
      globalThis.showToast?.(t(message));
      const status = document.querySelector("#status");
      if (status) status.textContent = t(message);
    }
  });
  return () => { alive = false; stop(); opened?.dispose(); };
}
