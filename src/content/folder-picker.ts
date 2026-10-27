import type { FolderPickerOptions, PickerProject } from "../picker/types";

import { openFolderPicker } from "../picker/ui";

// 网页内的整屏选项目浮层：显式导入共享 UI，并接上后台收藏消息。
// WXT 将整个入口包在函数作用域里；同一网页重复 executeScript 不会重复声明顶层变量。
declare global { interface Window { __laterOnPickerPayloadCleanup?: () => void; } }

export function showFolderPickerOverlay(payload: FolderPickerOptions & { readonly batchId?: string }): void {
  // 这个浮层可能在扩展更新后仍留在旧网页里；此时 sendMessage 会在返回 Promise
  // 之前同步抛错，所以安全包装必须同时覆盖同步 throw 与异步 reject。
  function safeRuntimeMessage(message: { readonly type: string; readonly name?: string; readonly projectId?: string | null; readonly batchId?: string }): Promise<{ readonly project?: PickerProject; readonly ok: boolean; readonly error?: string } | null> {
    try { return Promise.resolve(chrome.runtime.sendMessage(message)).catch(() => null); }
    catch { return Promise.resolve(null); }
  }

  const data = payload || {};

  // 主题：跟着扩展设置走；设置为「跟随系统」时看系统偏好。
  const theme = data.theme || "light";
  const folders = Array.isArray(data.folders) ? data.folders : [];
  const pages = Array.isArray(data.pages) ? data.pages : [];
  const savedCount = Number(data.savedCount) || 0;
  const selected = typeof data.selected === "string" ? data.selected : "";

  openFolderPicker({
    theme,
    language: data.language || "zh-CN",
    folders,
    selected,
    pages,
    savedCount,
    // 新建项目 / 确认收藏 / 取消收藏：都走后台那一套，行为和以前完全一致。
    // onCreateProject 按约定返回「项目对象 {id,name}」（不是后台那层 {ok,project} 包装），
    // 所以这里把响应拆开再交出去。
    onCreateProject: async (name) => {
      const response = await safeRuntimeMessage({ type: "CREATE_PROJECT", name });
      return response?.project || null;
    },
    onPick: (projectId) => safeRuntimeMessage({ type: "CONFIRM_BATCH_SAVE", projectId, batchId: data.batchId }),
    onCancel: () => safeRuntimeMessage({ type: "CANCEL_BATCH_SAVE", batchId: data.batchId })
  });
}

export function registerFolderPicker(): void {
  // 同一网页再次注入前，撤掉上一个实例还在等 payload 的一次性监听。
  // 扩展重载后旧监听若继续响应，会拿着失效的 runtime 再执行一遍浮层逻辑。
  try { window.__laterOnPickerPayloadCleanup?.(); } catch {}

  // 后台把配置放进一个一次性 JSON 节点再执行本文件：从这里读出 payload。
  // 配置和本文件可能并行注入，所以既检查现有节点，也监听后台发出的就绪事件。
  const consumePickerPayload = () => {
    const node = document.getElementById("lateron-picker-payload-data");
    let payload = null;
    try { payload = JSON.parse(node?.textContent || "null"); } catch {}
    node?.remove();
    if (!payload) return false;
    cleanupPayloadListener();
    showFolderPickerOverlay(payload);
    return true;
  };

  const onPayloadReady = () => consumePickerPayload();
  const cleanupPayloadListener = () => {
    document.removeEventListener("lateron-picker-payload-ready", onPayloadReady);
    if (window.__laterOnPickerPayloadCleanup === cleanupPayloadListener) delete window.__laterOnPickerPayloadCleanup;
  };

  window.__laterOnPickerPayloadCleanup = cleanupPayloadListener;
  document.addEventListener("lateron-picker-payload-ready", onPayloadReady, { once: true });
  consumePickerPayload();
}
