import type { Browser } from "wxt/browser";
import type { StoredItem, StoredProject, CollectionState } from "../storage/contracts";
import type { StoredSettings } from "../settings/shared";
import type { PageMetadata } from "../content/metadata.js";

export type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export type BackgroundItem = Mutable<StoredItem> & { url: string; contentHtml?: unknown; wordCount?: unknown; byline?: unknown };
export type BackgroundTab = Omit<Partial<Browser.tabs.Tab>, "status"> & { status?: string; suspended?: boolean };
export interface ResolvedProject { readonly id: string | null; readonly name: string; }
export type Metadata = Mutable<Omit<PageMetadata, "videoId" | "title" | "url">> & { title: string | undefined; url: string | undefined };
export type SaveInput = Partial<PageMetadata> & { readonly url: string };
export interface BatchOptions {
  readonly tabs: readonly BackgroundTab[];
  readonly source?: string;
  readonly notifyTabId?: number | null;
  readonly notifySuspended?: boolean;
  readonly projectId?: string | null;
  readonly projectName?: string;
}
export interface PendingBatch extends Omit<BatchOptions, "projectId" | "tabs"> {
  readonly projectId: string;
  readonly tabs: readonly (BackgroundTab & { readonly url: string })[];
  readonly batchId: string;
  readonly createdAt: number;
  readonly savedCount?: number;
}
export interface BackgroundSnapshot extends Omit<CollectionState, "laterOnItems" | "laterOnProjects"> {
  readonly laterOnItems?: BackgroundItem[];
  readonly laterOnProjects?: (StoredProject & { readonly name: string })[];
  readonly laterOnSettings?: StoredSettings;
  readonly laterOnLastProjectId?: string;
  readonly laterOnPendingBatch?: PendingBatch;
  readonly laterOnCleanupV165?: boolean;
  readonly laterOnDiag?: Readonly<Record<string, string | number | boolean>>;
}
export const errorMessage = (error: unknown): unknown => error && typeof error === "object" && "message" in error ? error.message || error : error;
const STORAGE_KEY = "laterOnItems";
const PROJECTS_KEY = "laterOnProjects";
const SETTINGS_KEY = "laterOnSettings";
const CURRENT_ITEM_KEY = "laterOnCurrentItem";

async function usesEnglish(): Promise<boolean> {
  try { return (await chrome.storage.local.get<BackgroundSnapshot>(SETTINGS_KEY))[SETTINGS_KEY]?.language === "en"; }
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
function withTimeout<T, F>(promise: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  return new Promise<T | F>((resolve) => {
    let settled = false;
    const finish = (value: T | F) => {
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

function safeHostname(url: string | undefined): string {
  try {
    return new URL(url ?? "").hostname.replace(/^www\./, "");
  } catch {
    return "网页";
  }
}

function isWebUrl(url: string | undefined): url is string {
  return /^https?:\/\//i.test(url || "");
}

export { usesEnglish, isWebUrl, STORAGE_KEY, PROJECTS_KEY, CURRENT_ITEM_KEY, SETTINGS_KEY, ORDER_KEY, COVERS_KEY, safeHostname, LAST_PROJECT_KEY, PENDING_KEY, withTimeout };
