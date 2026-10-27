import type { DialogService } from "./dialog.js";
import dialogStyleUrl from "../styles/dialog.css?url&no-inline";

let pending: Promise<DialogService> | undefined;

// 编辑不是首屏能力；原生动态导入让 WXT 管理脚本依赖，样式仍按需加载。
function loadStyle(): Promise<void> {
  if (document.querySelector("link[data-lateron-dialog-style]")) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = dialogStyleUrl;
    style.dataset.lateronDialogStyle = "";
    style.onload = () => resolve();
    style.onerror = () => { style.remove(); reject(new Error("Dialog style unavailable")); };
    document.head.append(style);
  });
}

export function loadDialog(needsStyle = true): Promise<DialogService> {
  pending ??= Promise.all([needsStyle ? loadStyle() : Promise.resolve(), import("./dialog.js").then(module => module.dialog)])
    .then(([, dialog]) => dialog)
    .catch(error => { pending = undefined; throw error; });
  return pending;
}
