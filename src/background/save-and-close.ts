import type { SavedTabTarget } from "./shared";
import { errorMessage, usesEnglish } from "./shared";
import { unwrapSuspendedUrl } from "../shared/url-utils";
import { recordDiag } from "./diagnostics";

export const CLOSE_AFTER_SAVE_DELAY_MS = 800;

// Wait after feedback, then close only the saved page. User navigation cancels closing.
export async function closeSavedTab(target: SavedTabTarget): Promise<void> {
  let navigated = false;
  const changed: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (id, change) => {
    if (id === target.id && (change.status === "loading" ||
      (change.url !== undefined && unwrapSuspendedUrl(change.url) !== target.url))) navigated = true;
  };
  chrome.tabs.onUpdated.addListener(changed);
  try {
    await new Promise<void>(resolve => setTimeout(resolve, CLOSE_AFTER_SAVE_DELAY_MS));
    const current = await chrome.tabs.get(target.id).catch(() => null);
    if (navigated || !current || unwrapSuspendedUrl(current.url || "") !== target.url ||
      (current.pendingUrl && unwrapSuspendedUrl(current.pendingUrl) !== target.url)) return;
    await chrome.tabs.remove(target.id);
  } catch (error) {
    const en = await usesEnglish();
    await recordDiag({ lastError: `${en ? "Saved, but the tab could not be closed" : "已收藏，但未能关闭标签页"}: ${String(errorMessage(error))}`,
      lastErrorAt: Date.now() });
  } finally {
    chrome.tabs.onUpdated.removeListener(changed);
  }
}
