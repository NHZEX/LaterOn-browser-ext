import type { BackgroundSnapshot } from "./shared";
// ── 诊断记录 ────────────────────────────────────────────────
// 快捷键有可能被 macOS 或其他软件半路截走，导致「按了没反应」。
// 这里把「是否收到按键 / 执行结果 / 报错」记到本地，设置页会展示出来，
// 一眼就能判断到底是按键没到达扩展，还是扩展执行时出错了。
const DIAG_KEY = "laterOnDiag";

async function recordDiag(patch: Readonly<Record<string, string | number | boolean>>): Promise<void> {
  try {
    const stored = await chrome.storage.local.get<BackgroundSnapshot>(DIAG_KEY);
    await chrome.storage.local.set({ [DIAG_KEY]: { ...(stored[DIAG_KEY] || {}), ...patch } });
  } catch {
    // 诊断信息写不进去不影响主流程。
  }
}

export { recordDiag };
