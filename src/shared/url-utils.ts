// Shared URL identity for collection, backup, navigation and reading position matching.
export interface SuspendedPage {
  readonly url: string;
  readonly title: string;
}

export interface UrlTab {
  readonly url?: string;
  readonly title?: string;
  readonly favIconUrl?: string;
}

// Widen rewritten fields, while retaining browser tab IDs and other caller metadata.
export type UnwrappedTab<T extends UrlTab> = Omit<T, keyof UrlTab | "suspended"> & UrlTab & {
  readonly suspended?: boolean;
};

function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value) || /[\s\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) && !!parsed.hostname;
  } catch { return false; }
}

function decode(value: string): string {
  try { return decodeURIComponent(value); } catch { return ""; }
}

/** Parse Suspender's raw uri tail without interpreting its &, +, # or escapes. */
export function suspendedPage(value: unknown): SuspendedPage | null {
  if (typeof value !== "string" || !/^chrome-extension:\/\//i.test(value)) return null;
  try {
    if (new URL(value).pathname !== "/suspended.html") return null;
    const hash = value.slice(value.indexOf("#") + 1);
    if (!value.includes("#")) return null;
    const uri = /(?:^|&)uri=/.exec(hash);
    const match = uri || /(?:^|&)url=([^&]*)/.exec(hash);
    if (!match) return null;
    const raw = uri ? hash.slice(uri.index + uri[0].length) : match[1] || "";
    // Older variants encode the whole URL. Decode once only when it is not raw HTTP(S).
    const url = isHttpUrl(raw) ? raw : /^https?%3a%2f%2f/i.test(raw) ? decode(raw) : "";
    if (!isHttpUrl(url)) return null;
    const metadata = hash.slice(0, match.index);
    const title = /(?:^|&)ttl=([^&]*)/.exec(metadata)?.[1] || "";
    return { url, title: decode(title) };
  } catch { return null; }
}

export function unwrapSuspendedUrl(value: string): string {
  return suspendedPage(value)?.url || value;
}

export function unwrapSuspendedTab<T extends UrlTab>(tab: T): UnwrappedTab<T> {
  if (!tab) return tab;
  const page = suspendedPage(tab.url);
  if (!page) return tab;
  const favicon = /^(https?:\/\/|data:image\/)/i.test(tab.favIconUrl || "") ? tab.favIconUrl : "";
  return { ...tab, url: page.url, title: page.title || tab.title || page.url, favIconUrl: favicon, suspended: true };
}

const compareKeys = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

/** Preserve explicit hash routes; ordinary document anchors share a page identity.
 * Route values stay raw: decoding can change +, %2F or an application's own syntax.
 */
function routeIdentity(hash: string): string {
  if (!/^#!?\//.test(hash)) return "";
  const nestedHash = hash.indexOf("#", 1);
  const end = nestedHash < 0 ? hash.length : nestedHash;
  const query = hash.indexOf("?");
  if (query < 0 || query >= end) return hash;
  const params = hash.slice(query + 1, end).split("&")
    .map((value) => ({ key: value.split("=", 1)[0] || "", value }))
    .sort((left, right) => compareKeys(left.key, right.key))
    .map(({ value }) => value).join("&");
  return `${hash.slice(0, query + 1)}${params}${hash.slice(end)}`;
}

/** Build a comparison key only; callers keep the original URL for storage/opening. */
export function normalize(url: string): string {
  try {
    const parsed = new URL(unwrapSuspendedUrl(url));
    const route = routeIdentity(parsed.hash);
    // 同一 YouTube 视频可能来自稍后观看、播放列表、短链接或移动端。
    // 用视频 ID 匹配；保留原始网址用于实际打开，不改变播放时间或列表。
    const hostname = parsed.hostname.toLowerCase();
    const youtube = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(hostname);
    let videoId = "";
    if (["http:", "https:"].includes(parsed.protocol) && !parsed.port) {
      if (["youtu.be", "www.youtu.be"].includes(hostname)) {
        videoId = parsed.pathname.match(/^\/([^/]+)\/?$/)?.[1] || "";
      } else if (youtube) {
        videoId = /^\/watch\/?$/.test(parsed.pathname)
          ? parsed.searchParams.get("v") || ""
          : parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)\/?$/)?.[1] || "";
      }
    }
    if (/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      return `https://youtube.com/watch?v=${videoId}${route}`;
    }
    const host = parsed.host.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    const keep = [...parsed.searchParams.entries()]
      .filter(([key]) => !/^(?:utm_|mc_|(?:fbclid|gclid|ref|spm|igshid)$)/i.test(key))
      .sort(([a], [b]) => compareKeys(a, b));
    const search = keep.length
      ? "?" + keep.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&")
      : "";
    return `${parsed.protocol}//${host}${path}${search}${route}`;
  } catch {
    return String(url || "").trim().toLowerCase();
  }
}
