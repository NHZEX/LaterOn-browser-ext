import { openFolderPicker } from "./ui.js";

// A protected suspended page cannot host the web overlay. Use LaterOn's own tab.
export async function startProjectPicker() {
  const batchId = new URL(location.href).searchParams.get("batch");
  const status = document.querySelector("#pickerStatus");
  const closeButton = document.querySelector("#closePicker");
  const close = async () => {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id) await chrome.tabs.remove(tab.id);
  };
  closeButton.addEventListener("click", () => close().catch(() => {}));
  const message = (type, extra = {}) => chrome.runtime.sendMessage({ type, batchId, ...extra });
  const settings = await chrome.storage.local.get("laterOnSettings").catch(() => ({}));
  const en = settings.laterOnSettings?.language === "en";
  document.documentElement.lang = en ? "en" : "zh-CN";
  document.title = en ? "Choose a project · LaterOn" : "选择项目 · LaterOn";
  closeButton.textContent = en ? "Close" : "关闭";
  try {
    const response = await message("GET_PENDING_PICKER");
    if (!response?.ok) throw new Error("BATCH_EXPIRED");
    openFolderPicker({
      ...response.payload,
      onCreateProject: async (name) => {
        const result = await message("CREATE_PROJECT", { name });
        return result?.project || null;
      },
      onPick: async (projectId) => {
        const result = await message("CONFIRM_BATCH_SAVE", { projectId });
        if (!result) return { ok: false };
        if (result.ok) await close().catch(() => {});
        return result;
      },
      onCancel: async () => {
        try { await message("CANCEL_BATCH_SAVE"); }
        finally { await close().catch(() => {}); }
      }
    });
    status.hidden = true;
  } catch {
    status.textContent = en ? "This collection request has expired or is unavailable. Start again from the page you want to add." : "这次收藏请求已过期或无法读取，请回到要收藏的页面重新发起。";
    closeButton.hidden = false;
  }
}
