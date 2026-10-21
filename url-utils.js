// Shared URL canonicalization for matching the active tab with saved items.
(function () {
  /** @param {string} value @returns {boolean} */
  function isHttpUrl(value) {
    if (!/^https?:\/\//i.test(value) || /[\s\u0000-\u001f\u007f]/.test(value)) return false;
    try {
      const parsed = new URL(value);
      return ["http:", "https:"].includes(parsed.protocol) && !!parsed.hostname;
    } catch { return false; }
  }

  /** @param {string} value @returns {string} */
  function decode(value) {
    try { return decodeURIComponent(value); } catch { return ""; }
  }

  /** Parse Suspender's raw uri tail without interpreting its &, +, # or escapes.
   * @param {unknown} value
   * @returns {{url:string, title:string}|null}
   */
  function suspendedPage(value) {
    if (typeof value !== "string" || !/^chrome-extension:\/\//i.test(value)) return null;
    try {
      if (new URL(value).pathname !== "/suspended.html") return null;
      const hash = value.slice(value.indexOf("#") + 1);
      if (!value.includes("#")) return null;
      const uri = /(?:^|&)uri=/.exec(hash);
      const legacy = uri ? null : /(?:^|&)url=([^&]*)/.exec(hash);
      if (!uri && !legacy) return null;
      const raw = uri ? hash.slice(uri.index + uri[0].length) : legacy[1];
      // Older variants encode the whole URL. Decode once only when it is not raw HTTP(S).
      const url = isHttpUrl(raw) ? raw : /^https?%3a%2f%2f/i.test(raw) ? decode(raw) : "";
      if (!isHttpUrl(url)) return null;
      const metadata = hash.slice(0, uri ? uri.index : legacy.index);
      const title = /(?:^|&)ttl=([^&]*)/.exec(metadata)?.[1] || "";
      return { url, title: decode(title) };
    } catch { return null; }
  }

  /** @param {string} value @returns {string} */
  function unwrapSuspendedUrl(value) {
    return suspendedPage(value)?.url || value;
  }

  /** @template {{url?:string, title?:string, favIconUrl?:string}} T
   * @param {T} tab @returns {T & {suspended?:boolean}}
   */
  function unwrapSuspendedTab(tab) {
    if (!tab) return tab;
    const page = suspendedPage(tab.url);
    if (!page) return tab;
    const favicon = /^(https?:\/\/|data:image\/)/i.test(tab.favIconUrl || "") ? tab.favIconUrl : "";
    return { ...tab, url: page.url, title: page.title || tab.title || page.url, favIconUrl: favicon, suspended: true };
  }

  function normalize(url) {
    try {
      const parsed = new URL(url);
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
        return `https://youtube.com/watch?v=${videoId}`;
      }
      const host = parsed.host.toLowerCase().replace(/^www\./, "");
      const path = parsed.pathname.replace(/\/+$/, "") || "/";
      const keep = [...parsed.searchParams.entries()]
        .filter(([key]) => !/^(utm_|fbclid|gclid|mc_|ref|spm|igshid)/i.test(key))
        .sort(([a], [b]) => a.localeCompare(b));
      const search = keep.length
        ? "?" + keep.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&")
        : "";
      return `${parsed.protocol}//${host}${path}${search}`;
    } catch {
      return String(url || "").trim().toLowerCase();
    }
  }

  globalThis.LaterOnUrl = { normalize, suspendedPage, unwrapSuspendedUrl, unwrapSuspendedTab };
})();
