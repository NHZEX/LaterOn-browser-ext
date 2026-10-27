import { isWebUrl, PROJECTS_KEY, STORAGE_KEY, SETTINGS_KEY, COVERS_KEY, withTimeout, PENDING_KEY, LAST_PROJECT_KEY } from "./shared.js";
import { enqueue as queueItemWrite, execute } from "../storage/coordinator";
import { resolveProject } from "./collection.js";
import { recordDiag } from "./diagnostics.js";
import { buildPayload } from "../collection/picker";

// ── 网页内的「选择项目」浮层 ──────────────────────────────
// 在用户当前所在的网页里直接弹出一个居中浮层（不新开窗口），选好项目再开始收藏。
// 内容全部放在 Shadow DOM 里，页面自身的 CSS 影响不到它，所以视觉可以和扩展界面
// 完全保持一致（同一套圆角、阴影、渐变按钮、深色模式）。
// 页面正在跳转、冻结或渲染进程短暂无响应时，executeScript 可能一直不返回。
// 选项目浮层不能跟着无限等待：到点就交回 false，让调用方重试网页内浮层。
const PICKER_INJECT_TIMEOUT_MS = 1600;
const PICKER_VERIFY_TIMEOUT_MS = 700;
const pickerRunByTab = new Map();

async function showPickerOverlay(tab, payload) {
  if (!tab?.id || tab.suspended || !isWebUrl(tab.url)) return false;
  const runId = (pickerRunByTab.get(tab.id) || 0) + 1;
  pickerRunByTab.set(tab.id, runId);
  try {
    const stored = await chrome.storage.local.get([PROJECTS_KEY, STORAGE_KEY, SETTINGS_KEY, COVERS_KEY]);
    const pickerPayload = buildPayload(stored, payload || {});
    // files 注入不能直接带 args：先把很小的配置放进一个一次性 JSON 节点，
    // 再执行真正的 UI 文件。用 DOM 传递比依赖两次注入共享全局变量更稳。
    // 配置节点和 UI 文件可以并行注入：content-folder-picker.js 会监听配置就绪事件，
    // 即使两条注入的先后顺序不同，也能在两者都到位后立即打开浮层。
    const [payloadInjected, uiInjected] = await Promise.all([
      withTimeout(
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (value, id) => {
            const previous = Number(globalThis.__laterOnPickerRunId || 0);
            if (previous > id) return;
            globalThis.__laterOnPickerRunId = id;
            const nodeId = "lateron-picker-payload-data";
            document.getElementById(nodeId)?.remove();
            const node = document.createElement("script");
            node.id = nodeId;
            node.type = "application/json";
            node.textContent = JSON.stringify(value);
            document.documentElement.appendChild(node);
            document.dispatchEvent(new CustomEvent("lateron-picker-payload-ready"));
          },
          args: [pickerPayload, runId]
        }),
        PICKER_INJECT_TIMEOUT_MS,
        null
      ),
      withTimeout(
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          // 共享面板与消息适配由 WXT 打包为一个按需入口，不依赖网页全局桥接。
          files: ["content-folder-picker.js"]
        }),
        PICKER_INJECT_TIMEOUT_MS,
        null
      )
    ]);
    if (!Array.isArray(uiInjected)) return false;
    if (!Array.isArray(payloadInjected)) return false;
    if (pickerRunByTab.get(tab.id) !== runId) return false;

    // executeScript 成功只代表文件执行完，不代表浮层一定留在页面上。
    // 页面恰好导航、DOM 被站点重建、共享 UI 初始化失败时，主动确认宿主确实存在；
    // 看不到就返回 false，由调用方再尝试一次同一种网页内浮层。
    const verified = await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => !!document.getElementById("lateron-folder-picker")?.shadowRoot
      }),
      PICKER_VERIFY_TIMEOUT_MS,
      null
    );
    return Array.isArray(verified) && verified.some((entry) => entry?.result === true);
  } catch {
    // 页面受保护 / 权限不足 / 标签已关闭：返回失败，不创建其它形态的选择窗口。
    return false;
  }
}

// 新建项目（浮层和收藏库共用同一份数据，形状保持一致）。
async function createProject(name, epoch) {
  return execute({ action: "createProject", name, epoch });
}

// 体积较大的网页执行代码已移到 content-folder-picker.js，仅在实际使用时注入目标网页。

// 取出「等待选择项目」的那一批标签页，并记录用户选的项目。
// 返回 null 表示没有待处理的批次（重复点击 / 已过期）。
async function getPendingPickerPayload(batchId) {
  const pending = (await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY];
  if (!batchId || pending?.batchId !== batchId || Date.now() - pending.createdAt > 10 * 60 * 1000) return { ok: false };
  const stored = await chrome.storage.local.get([PROJECTS_KEY, STORAGE_KEY, SETTINGS_KEY, COVERS_KEY]);
  return { ok: true, payload: buildPayload(stored, pending) };
}

async function claimPendingBatch(projectId, batchId) {
  return queueItemWrite(async () => {
    const stored = await chrome.storage.session.get(PENDING_KEY);
    const pending = stored[PENDING_KEY];
    if (!pending || !pending.tabs?.length || (batchId !== undefined && pending.batchId !== batchId)) return null;
    if (Date.now() - (pending.createdAt || 0) > 10 * 60 * 1000) {
      await chrome.storage.session.remove(PENDING_KEY);
      return null;
    }
    await chrome.storage.session.remove(PENDING_KEY);

    // 用户选的项目在这段时间里可能被删掉了（浮层最长会停留 10 分钟），
    // 这里再校验一次：不存在就退回「待整理」，不给收藏留下悬空的归属。
    const chosen = await resolveProject(projectId);

    if (chosen.id) await chrome.storage.local.set({ [LAST_PROJECT_KEY]: chosen.id });
    else await chrome.storage.local.remove(LAST_PROJECT_KEY);

    return {
      tabs: pending.tabs,
      source: pending.source || "shortcut",
      notifyTabId: pending.notifyTabId ?? null,
      notifySuspended: !!pending.notifySuspended,
      projectId: chosen.id,
      projectName: chosen.name
    };
  });
}

async function cancelPendingBatch(batchId) {
  return queueItemWrite(async () => {
    const stored = await chrome.storage.session.get(PENDING_KEY);
    if (batchId !== undefined && stored[PENDING_KEY]?.batchId !== batchId) return { ok: false, cancelled: false };
    const had = !!stored[PENDING_KEY];
    await chrome.storage.session.remove(PENDING_KEY);
    if (had) await recordDiag({ lastStage: "已取消（没有添加任何页面）", lastResultAt: Date.now() });
    return { ok: true, cancelled: had };
  });
}

export { cancelPendingBatch, getPendingPickerPayload, createProject, showPickerOverlay, claimPendingBatch, PICKER_INJECT_TIMEOUT_MS };
