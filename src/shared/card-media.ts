// 修饰键点击直接遵循 href，链接必须在事件处理前就安全。
export function cardTarget(value: string | undefined): string {
  try { return ["http:", "https:"].includes(new URL(value ?? "").protocol) ? (value ?? "").trim() : ""; }
  catch { return ""; }
}

// 部分 YouTube 视频没有最高分辨率封面，逐级降级，耗尽后露出 Logo 占位。
export function nextCoverFallback(currentSrc: string): string {
  let url: URL;
  try { url = new URL(currentSrc); } catch { return ""; }
  const matched = /^\/vi\/([^/]+)\/([^/]+\.jpg)$/.exec(url.pathname);
  if (!matched || url.hostname !== "i.ytimg.com") return "";
  const chain = ["maxresdefault.jpg", "hq720.jpg", "hqdefault.jpg", "mqdefault.jpg"];
  const index = chain.indexOf(matched[2] ?? "");
  const next = index >= 0 ? chain[index + 1] : undefined;
  if (!next) return "";
  url.pathname = `/vi/${matched[1]}/${next}`;
  url.search = "";
  return url.href;
}
