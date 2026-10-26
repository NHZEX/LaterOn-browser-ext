import { usesEnglish, isWebUrl, withTimeout, safeHostname } from "./shared.js";
import { unwrapSuspendedTab } from "../shared/url-utils";
import { titleHasSiteNoise, isIconLikeImage } from "./duplicate-metadata.js";

// 读取单个标签页的标题 / 摘要 / 封面 / 图标。
// 顺序处理时每个标签最多等 3 秒（比原来并发时给得更宽松，尽量把封面/摘要抓全）；
// 超时就退回浏览器已有的信息（标题 + 图标），绝不拖住后面的标签。
export const EXTRACT_TIMEOUT_MS = 3000;

// 供弹窗 / 侧栏调用：读取指定标签页的标题 / 摘要 / 封面 / 图标。
// 失败时返回 ok:false，调用方自己退回「标签页基础信息」。
async function extractTabMetadataById(tabId) {
  const en = await usesEnglish();
  if (!tabId) return { ok: false, error: en ? "Missing tab" : "缺少标签页" };
  let tab = null;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    tab = null;
  }
  if (!tab) return { ok: false, error: en ? "This tab couldn’t be found" : "找不到这个标签页" };
  tab = unwrapSuspendedTab(tab);
  if (!isWebUrl(tab.url)) return { ok: false, error: en ? "This page can’t be added. Open a regular web page and try again." : "这个页面无法添加，请打开一个普通网页后重试。" };
  const metadata = await extractTabMetadata(tab);
  return { ok: true, metadata: { ...metadata, url: tab.url } };
}

// ── 抖音：滑动切换视频后，先等 DOM「跟上」当前网址再抓 ──────────────
// 抖音是单页应用。实测站内切换视频时各信号的更新时间线（无头 Chrome，逐 100ms 采样）：
//   切换前  网址=76595  面板=76595  标题=第181集  封面=旧
//   +102ms  网址=96420  面板=76595 标题=第181集  封面=旧   ← 网址已换，面板还是上一条
//   +318ms  网址=96420  面板=96420 标题=第182集  封面=新   ← 全部对齐
// 也就是说「只有网址是瞬时正确的」，标题面板与封面滞后 0.15~0.3 秒（网络慢时更久）。
// 用户滑到下一条视频后立刻按快捷键，就会把上一条的标题和封面存进去——
// 这正是「刷新一下页面就好了」的原因（刷新时网址已指向新视频，重渲染后就对了）。
// 所以对抖音先等面板与网址对齐，最多等 1.5 秒；等不到就尽力而为，绝不无限期拖住。
const DOUYIN_SETTLE_MS = 1500;
const DOUYIN_POLL_MS = 100;

function isDouyinUrl(url) {
  try {
    const host = new URL(url).hostname;
    return /(^|\.)douyin\.com$/.test(host) || /(^|\.)iesdouyin\.com$/.test(host);
  } catch {
    return false;
  }
}

// 从网址里取当前视频 id。详情页是 /video/<id> 或 /note/<id>；
// 首页推荐流用 modal_id 参数承载「正在看哪一条」。
// 先验域名：否则任何网站的 /video/<数字> 都会被当成抖音视频 id（那样很危险）。
function douyinVideoIdFromUrl(url) {
  if (!isDouyinUrl(url)) return "";
  const text = String(url || "");
  const matched =
    /\/video\/(\d{10,})/.exec(text) ||
    /\/note\/(\d{10,})/.exec(text) ||
    /[?&]modal_id=(\d{10,})/.exec(text) ||
    /[?&]vid=(\d{10,})/.exec(text);
  return matched ? matched[1] : "";
}

// 注入到页面里执行（必须自包含）：只读两个 id，判断「标题面板是否已经切到当前这条视频」。
// 面板上的 data-e2e-aweme-id 就是它对应的视频 id，拿它跟「网址里的 id / lark 元数据里的 id」
// 一比，就知道画面上的标题到底属于哪一条。
function probeDouyinFreshness() {
  const idOf = (value) => (String(value || "").match(/(\d{10,})/) || [])[1] || "";
  const panel = document.querySelector('[data-e2e="detail-video-info"]');
  const iframe = document.querySelector('meta[name="lark:url:video_iframe_url"]');
  return {
    urlId:
      (/\/video\/(\d{10,})/.exec(location.href) || [])[1] ||
      (/\/note\/(\d{10,})/.exec(location.href) || [])[1] ||
      (/[?&]modal_id=(\d{10,})/.exec(location.href) || [])[1] ||
      "",
    panelId: panel ? panel.getAttribute("data-e2e-aweme-id") || "" : "",
    larkId: iframe ? idOf(iframe.getAttribute("content")) : ""
  };
}

// 等「标题面板」切到当前网址所指向的那条视频。deadline 由调用方给，
// 这样「等待」和「等完再复核」共用同一份时间预算，不会叠加成好几秒。
async function settleDouyinDom(tab, deadline = Date.now() + DOUYIN_SETTLE_MS) {
  if (!isDouyinUrl(tab?.url)) return;
  if (!tab?.id || tab.discarded || tab.status === "unloaded") return;

  const urlId = douyinVideoIdFromUrl(tab.url);

  for (;;) {
    let probe;
    try {
      const out = await withTimeout(
        chrome.scripting.executeScript({ target: { tabId: tab.id }, func: probeDouyinFreshness }),
        900,
        null
      );
      probe = out?.[0]?.result;
    } catch {
      return; // 注入失败（受保护页面等）就直接放弃，交给后面的兜底逻辑。
    }
    // 面板没有 id 属性（或页面上根本没有面板）→ 无法校验，不浪费时间。
    if (!probe || !probe.panelId) return;

    // 网址里的 id 最权威；首页推荐流没有 id 时用 lark 元数据里的 id 兜底。
    const expected = urlId || probe.larkId;
    if (!expected || probe.panelId === expected) return; // 已对齐 → DOM 是新鲜的
    if (Date.now() >= deadline) return; // 等不到就尽力而为
    await new Promise((resolve) => setTimeout(resolve, DOUYIN_POLL_MS));
  }
}

// ── 服务端 meta 兜底 ──────────────────────────────────────────────
// 场景（topbook.cc 实测）：这类站点点开文章是「弹窗」，网址靠 pushState 变化，
// head 里的 og 标签根本不会更新——页面里能看到的还是列表页那一套
// （og:image 是站点 icon、og:title 是首页标题）。但直接向服务器请求「当前网址」，
// 返回的 HTML 里却带着这篇内容正确的 og 标签（SSR 渲染）。
// 所以当「页面里抓到的明显是站点通用值」时，由 background 重新请求一次网址补救。
const SERVER_META_TIMEOUT_MS = 8000;

async function refetchMetaFromServer(url) {
  if (!/^https?:\/\//i.test(url || "")) return null;
  try {
    const response = await withTimeout(fetch(url, { credentials: "omit" }), SERVER_META_TIMEOUT_MS, null);
    if (!response || !response.ok) return null;
    if (!/text\/html/i.test(response.headers.get("content-type") || "")) return null;
    // og 标签都在文档头部，前 200KB 足够。
    const html = (await withTimeout(response.text(), SERVER_META_TIMEOUT_MS, "")) || "";
    const head = html.slice(0, 200000);

    const decode = (text) =>
      (text || "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;|&apos;/g, "'")
        .replace(/&nbsp;/g, " ")
        .trim();

    // og 标签的属性顺序不固定（content 可能写在 property 前面），两种写法都试。
    const metaTag = (name) => {
      const forward = new RegExp(
        `<meta[^>]+(?:property|name)=["']${name}["'][^>]*?content=["']([^"']*)["']`,
        "i"
      ).exec(head);
      const reversed = new RegExp(
        `<meta[^>]+content=["']([^"']*)["'][^>]*?(?:property|name)=["']${name}["']`,
        "i"
      ).exec(head);
      return decode(forward?.[1] || reversed?.[1]);
    };
    const pageTitle = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]);

    // 相对地址（/img/cover.jpg）补全成绝对地址。
    const absolute = (value) => {
      if (!value) return "";
      try {
        return new URL(value, url).href;
      } catch {
        return value;
      }
    };

    return {
      title: metaTag("og:title") || metaTag("twitter:title") || pageTitle,
      description: metaTag("og:description") || metaTag("twitter:description") || metaTag("description"),
      image: absolute(
        metaTag("og:image") || metaTag("og:image:url") || metaTag("og:image:secure_url") || metaTag("twitter:image")
      )
    };
  } catch {
    return null;
  }
}

// 给「明显是站点通用值」的抓取结果做服务端兜底（说明见 refetchMetaFromServer）：
// 标题是标签页/文档标题兜底、或标题里混着站点名（首页 og:title 停在列表页的痕迹）、
// 或封面缺失/是站点图标时，重新请求一次网址，用服务器 HTML 里的 og 标签补齐。
// 原地修改并返回 result。
async function applyServerMetaRescue(result) {
  const titleIsWeak =
    ["tab", "page-title", "none", "page", "meta-title"].includes(result.titleFrom) ||
    (result.titleFrom !== "dom-headline" && titleHasSiteNoise(result.title, result.source));
  const imageIsWeak = !result.image || isIconLikeImage(result.image);
  if (!titleIsWeak && !imageIsWeak) return result;

  const server = await refetchMetaFromServer(result.url);
  if (server) {
    const serverTitleUsable =
      server.title &&
      server.title !== result.title &&
      server.title.toLowerCase() !== String(result.source || "").toLowerCase();
    if (titleIsWeak && serverTitleUsable) {
      result.title = server.title;
      result.titleFrom = "server";
    }
    if (imageIsWeak && server.image && !isIconLikeImage(server.image)) {
      result.image = server.image;
      result.imageFrom = "server";
    }
    if (result.description === "暂无摘要" && server.description) {
      result.description = server.description;
    }
  }
  return result;
}

async function extractTabMetadata(tab) {
  tab = unwrapSuspendedTab(tab);
  const fallback = {
    title: tab.title || tab.url,
    titleFrom: "tab",
    description: "暂无摘要",
    image: "",
    imageFrom: "none",
    favicon: tab.favIconUrl || "",
    source: safeHostname(tab.url),
    url: tab.url
  };

  // 休眠（内存被回收）或从未加载过的标签，注入脚本注定要等到超时，
  // 这种情况直接用浏览器已有的标题和图标，省下几秒白等。
  // 就算注入失败，服务端兜底也还能补救（弹窗类站点的标签页标题同样是错的）。
  if (tab.discarded || tab.status === "unloaded" || tab.suspended) return applyServerMetaRescue(fallback);

  // 抖音滑动切换视频后，标题面板与封面会滞后于网址；先等它对齐，否则会抓到上一条视频。
  // 等待 + 事后复核共用同一个截止时间，所以最多只耽搁 DOUYIN_SETTLE_MS。
  const expectedId = isDouyinUrl(tab.url) ? douyinVideoIdFromUrl(tab.url) : "";
  const deadline = Date.now() + DOUYIN_SETTLE_MS;
  if (isDouyinUrl(tab.url)) await settleDouyinDom(tab, deadline);

  for (;;) {
    const data = await readTabMetadata(tab);
    if (!data) return applyServerMetaRescue(fallback);

    // 复核：提取脚本会回报它实际读到的视频 id（面板上的那个）。
    // 跟网址一对，就知道读到的标题/封面是不是这条视频的。对不上就趁剩下的时间再读一次。
    if (expectedId && data.videoId && data.videoId !== expectedId && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, DOUYIN_POLL_MS));
      continue;
    }

    const result = {
      title: data.title || fallback.title,
      titleFrom: data.title ? data.titleFrom || "page" : "tab",
      description: data.description || fallback.description,
      image: data.image || "",
      imageFrom: data.imageFrom || "none",
      favicon: data.favicon || fallback.favicon,
      source: data.source || fallback.source,
      url: tab.url
    };
    return applyServerMetaRescue(result);
  }
}

// 往页面注入一次提取脚本，拿回原始结果（注入失败或超时都返回 null）。
// 体积较大的网页执行代码保留在 content-metadata.js，仅在实际使用时注入目标网页。
async function readTabMetadata(tab) {
  try {
    const injection = await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content-metadata.js"]
      }),
      EXTRACT_TIMEOUT_MS,
      null
    );
    return injection?.[0]?.result || null;
  } catch {
    return null;
  }
}

export { extractTabMetadataById, extractTabMetadata, probeDouyinFreshness, isDouyinUrl, douyinVideoIdFromUrl, settleDouyinDom, refetchMetaFromServer, applyServerMetaRescue };
