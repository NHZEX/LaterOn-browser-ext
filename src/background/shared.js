const STORAGE_KEY = "laterOnItems";
const PROJECTS_KEY = "laterOnProjects";
const SETTINGS_KEY = "laterOnSettings";
const CURRENT_ITEM_KEY = "laterOnCurrentItem";

async function usesEnglish() {
  try { return (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]?.language === "en"; }
  catch { return false; }
}

// 收藏卡片的自定义顺序（全屏 / 侧栏共用）：清掉收藏时也要把顺序里的 id 一并去掉。
const ORDER_KEY = "laterOnOrder";

// 用户自己上传的封面（体积大）：单独一个键存放 { 收藏 id: dataURL }，
// 收藏条目里只记 local://<id> 指针；清除过期收藏时要把对应封面也删掉。
const COVERS_KEY = "laterOnCovers";

// 「一键收藏」待处理的那一批标签页：临时存在 session 里（关掉浏览器就没了，不占磁盘）。
const PENDING_KEY = "laterOnPendingBatch";

// 上次用过的项目：下次弹窗时默认选中它。
const LAST_PROJECT_KEY = "laterOnLastProjectId";

// 给 Promise 加超时：到点就返回兜底值，绝不让整个流程无限期卡住。
// executeScript 遇到卡死的页面（未加载完、被冻结、渲染进程无响应）可能长时间不返回，
// 批量场景下只要有标签卡住，整个「一键收藏」就会石沉大海（用户看到的就是「没反应」）。
function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(fallback), ms);
    promise.then(
      (value) => finish(value),
      () => finish(fallback)
    );
  });
}

function safeHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "网页";
  }
}

function isWebUrl(url) {
  return /^https?:\/\//i.test(url || "");
}

export { usesEnglish, isWebUrl, STORAGE_KEY, PROJECTS_KEY, CURRENT_ITEM_KEY, SETTINGS_KEY, ORDER_KEY, COVERS_KEY, safeHostname, LAST_PROJECT_KEY, PENDING_KEY, withTimeout };
