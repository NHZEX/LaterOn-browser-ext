// Pages read for display and send business commands; no writable array snapshots.
(function () {
  const EPOCH = "laterOnCollectionEpoch";
  let epoch;
  let invalidated = false;
  const initialize = (stored) => { if (epoch === undefined) epoch = stored[EPOCH] || ""; };
  const reload = () => {
    if (/\/(library|sidepanel)\.html$/.test(location.pathname)) location.reload();
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[EPOCH]) return;
    invalidated = true;
    try { localStorage.removeItem("laterOnPanelCache"); } catch { /* Optional cache. */ }
    reload();
  });

  /**
   * Send one operation; the worker computes its storage changes from current data.
   * @template {CollectionOperation['action']} A
   * @param {A} action
   * @param {Omit<Extract<CollectionOperation, {action:A}>, 'action'>} fields
   * @returns {Promise<CollectionCommandResult>}
   */
  async function run(action, fields = {}) {
    if (epoch === undefined) throw new Error("COLLECTION_NOT_LOADED");
    const response = invalidated ? { ok: false, error: "STALE_COLLECTION" }
      : await chrome.runtime.sendMessage({ ...fields, type: "COLLECTION_COMMAND", action, epoch })
        .catch(() => ({ ok: false, error: "COLLECTION_WRITE_FAILED" }));
    if (response?.ok) return response;
    const code = response?.error || "COLLECTION_WRITE_FAILED";
    const t = (key) => window.LaterOnI18n?.t(key) || key;
    const message = code === "STALE_COLLECTION" ? "backupDataChanged" : code === "DUPLICATE_PROJECT_NAME" ? "duplicateProject" : "backupOperationFailed";
    if (code === "STALE_COLLECTION") {
      await window.LaterOnDialog?.alert({ tone: "danger", title: t("operationFailed"), message: t(message) });
      reload();
    } else {
      window.showToast?.(t(message));
      const status = window.document?.querySelector("#status");
      if (status) status.textContent = t(message);
    }
    throw new Error(code);
  }
  globalThis.LaterOnStorage = { initialize, run };
})();
