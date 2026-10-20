(function () {
  const t = (...args) => window.LaterOnI18n.t(...args);
  const input = document.querySelector("#importFile");
  const buttons = ["exportBtn", "exportImages", "importBtn", "importMode"].map((id) => document.getElementById(id));
  const busy = (value) => buttons.forEach((button) => { button.disabled = value; });
  const errorMessage = (error) => {
    const code = String(error?.message || error);
    if (code.startsWith("INVALID_BACKUP:")) return t("backupInvalid");
    const keys = { UNSUPPORTED_BACKUP: "backupUnsupported", BACKUP_TOO_LARGE: "backupTooLarge",
      IMPORT_PREVIEW_EXPIRED: "backupPreviewExpired", IMPORT_DATA_CHANGED: "backupDataChanged" };
    return keys[code] ? t(keys[code]) : t("backupOperationFailed");
  };
  const request = async (message) => {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || "BACKUP_FAILED");
    return response;
  };
  const failure = (error, title) => LaterOnDialog.alert({ tone: "danger", title: t(title), message: errorMessage(error) });

  document.querySelector("#exportBtn").addEventListener("click", async () => {
    busy(true);
    try {
      const { payload } = await request({ type: "BACKUP_EXPORT", includeImages: document.querySelector("#exportImages").checked });
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      if (blob.size > 50 * 1024 * 1024) throw new Error("BACKUP_TOO_LARGE");
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = `lateron-backup-${payload.exportedAt.replace(/[:.]/g, "-")}.json`;
        link.click();
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (error) { await failure(error, "backupExportFail"); }
    finally { busy(false); }
  });

  document.querySelector("#importBtn").addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    const mode = document.querySelector("#importMode").value;
    busy(true);
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error("BACKUP_TOO_LARGE");
      let payload;
      try { payload = JSON.parse((await file.text()).replace(/^\uFEFF/, "")); }
      catch { throw new Error("INVALID_BACKUP:json"); }
      const preview = await request({ type: "BACKUP_PREVIEW", payload, mode });
      const counts = t("backupCounts", preview.incoming);
      const details = mode === "replace" ? t("backupReplacePreview", { items: preview.current.items, projects: preview.current.projects })
        : t("backupMergePreview", { added: preview.added, projects: preview.addedProjects, duplicates: preview.duplicates });
      const confirmed = await LaterOnDialog.confirm({ tone: mode === "replace" ? "danger" : "question",
        title: t(mode === "replace" ? "backupReplaceTitle" : "backupMergeTitle"),
        message: `${counts}\n${details}\n${t("backupPreferencesKept")}`,
        confirmText: t(mode === "replace" ? "backupReplaceConfirm" : "backupMergeConfirm") });
      if (!confirmed) return;
      const result = await request({ type: "BACKUP_APPLY", token: preview.token, payload, mode });
      try { localStorage.removeItem("laterOnPanelCache"); } catch { /* Optional cache. */ }
      await LaterOnDialog.alert({ tone: "success", title: t("importDoneTitle"), message: t(mode === "replace" ? "backupReplaceDone" : "backupMergeDone", result) });
    } catch (error) { await failure(error, "importFailTitle"); }
    finally { input.value = ""; busy(false); }
  });
})();
