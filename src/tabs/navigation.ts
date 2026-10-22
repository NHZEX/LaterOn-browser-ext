import { browser } from "wxt/browser";
import type { Browser } from "wxt/browser";
import { normalize, unwrapSuspendedUrl } from "../shared/url-utils.ts";

export interface FindOpenOptions {
  readonly excludeTabId?: number;
}

export interface TabReference {
  readonly id?: number;
  readonly windowId?: number;
}

// Compare page identities without changing the URL of an existing tab.
export function comparable(url: string | undefined): string {
  try {
    const parsed = new URL(unwrapSuspendedUrl(url || ""));
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return normalize(parsed.href);
  } catch {
    return "";
  }
}

export async function findOpen(target: string, options: FindOpenOptions = {}): Promise<Browser.tabs.Tab | null> {
  const expected = comparable(target);
  if (!expected) return null;
  const tabs = await browser.tabs.query({}).catch(() => []);
  const matches = tabs.filter((tab) => tab.id !== options.excludeTabId
    && comparable(tab.url || tab.pendingUrl) === expected);
  return matches.find((tab) => tab.active) || matches[0] || null;
}

export async function activate(tab: TabReference | null | undefined): Promise<boolean> {
  if (!tab?.id) return false;
  await browser.tabs.update(tab.id, { active: true }).catch(() => null);
  if (tab.windowId != null && typeof browser.windows?.update === "function") {
    await browser.windows.update(tab.windowId, { focused: true }).catch(() => null);
  }
  return true;
}
