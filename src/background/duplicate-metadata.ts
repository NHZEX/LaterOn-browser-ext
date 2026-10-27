import type { BackgroundItem } from "./shared";
import type { PageMetadata } from "../content/metadata";
// 判断一条已有收藏的文案是不是「没意义的占位值」——空、或者只是站点通用名
// （例如在 YouTube 首页级别的页面收藏到的标题就是 "YouTube"）。
function isPlaceholderText(value: string | undefined, source?: string): boolean {
  const text = (value || "").trim();
  if (!text) return true;
  if (/^youtube$/i.test(text)) return true;
  if (source && text.toLowerCase() === String(source).trim().toLowerCase()) return true;
  // 标题被存成了网址，说明当初根本没抓到标题（页面还没渲染完等）。
  if (/^https?:\/\//i.test(text)) return true;
  // 标题被存成了域名（example.com 这种兜底值）也算没抓到。
  if (/^[a-z0-9-]+(\.[a-z]{2,}){1,2}$/i.test(text)) return true;
  // 明显的导航词 / 通用词，同样视为「没抓到标题」。
  // 这样重复收藏一次，就会自动把标题补成正确的。
  if (/^(首页|主页|登录|注册|搜索|搜索结果|全部|分类|列表|购物车|loading|untitled|无标题|error|not found|404)$/i.test(text)) return true;
  return false;
}

// 标题里混着站点名（「文章标题 - 某某网」这类）也算「不干净」，
// 允许重复收藏时用新抓到的、更干净的标题替换掉它。
// 两类都算：
//  · 整个站点名出现在标题里（某某网 / example.com）；
//  · 标题尾巴是站点名的某一段（en.wikipedia.org → wikipedia）。
function titleHasSiteNoise(title: string | undefined, source: string | undefined): boolean {
  const text = (title || "").trim();
  const site = (source || "").trim();
  if (!text) return false;
  if (site.length >= 2 && text.toLowerCase().includes(site.toLowerCase())) return true;
  const words = site
    .toLowerCase()
    .split(/[.\s/]+/)
    .filter((word) => word.length >= 3 && word !== "www" && word !== "com");
  if (!words.length) return false;
  const tail = /[|·•\-–—_/]\s*([\p{Script=Han}A-Za-z0-9]{2,10})$/u.exec(text);
  return !!tail && words.includes(tail[1]!.toLowerCase());
}

// 重复收藏同一条网址时，决定要不要用「新抓到的信息」刷新旧记录。
// · 用户亲手改过的字段（titleEdited / descriptionEdited / imageEdited）一律不碰，优先级最高。
// · YouTube：元数据按视频 id 唯一确定，而且历史上很容易抓到「上一个页面」的错误信息
//   （详见提取函数里的说明），所以一律刷新，这样重新收藏一次就能把旧的错误信息修好。
// · 其它网站：只补「缺的」，不无谓改动你已经看到的内容。
// 返回值表示是否真的改动了内容。
function mergeDuplicateMetadata(existing: BackgroundItem, meta: Partial<PageMetadata>): boolean {
  const url = meta.url || existing.url || "";
  const isYouTube = /(^|\.)youtube(-nocookie)?\.com\//i.test(url) || /^https?:\/\/youtu\.be\//i.test(url);
  let changed = false;

  // 用户在收藏库里亲手改过的标题 / 摘要一律锁住：哪怕 YouTube 也不覆盖，
  // 否则下次重复收藏同一网址，他改好的内容会被自动抓取的结果顶掉。
  const titleLocked = existing.titleEdited === true;
  const descriptionLocked = existing.descriptionEdited === true;

  // 新标题必须是个「像样的标题」才允许替换，免得把好标题换成 example.com 这种兜底值。
  const nextTitleUsable = !!meta.title && !isPlaceholderText(meta.title, meta.source);
  const existingTitleWeak =
    isPlaceholderText(existing.title, existing.source) || titleHasSiteNoise(existing.title, existing.source);
  // 还有一种情况：新标题正好是老标题「去掉尾巴」的结果
  // （老：「富贵少爷…名场面 - 小红书」→ 新：「富贵少爷…名场面」）。
  // 这时新的一定更干净，可以放心替换。这条能覆盖那些中文站点——
  // 它们在页面上从不声明自己的名字，光靠 source 判断不出来。
  const existingTitleIsNoisier =
    nextTitleUsable &&
    typeof existing.title === "string" &&
    existing.title.length > meta.title.length &&
    existing.title.startsWith(meta.title) &&
    /^[\s|·•\-–—_/]/.test(existing.title.slice(meta.title.length));
  if (!titleLocked && nextTitleUsable && meta.title !== existing.title && (isYouTube || existingTitleWeak || existingTitleIsNoisier)) {
    existing.title = meta.title;
    changed = true;
  }
  // 用户自己上传/移除过的封面一律锁住：重复收藏时不拿自动抓取的图顶掉它。
  const imageLocked = existing.imageEdited === true;
  // 旧封面是「站点图标」（topbook 弹窗类站点的历史遗留）时也允许替换，
  // 否则重复收藏永远修不好那个错误的封面。
  if (!imageLocked && meta.image && meta.image !== existing.image && (isYouTube || !existing.image || isIconLikeImage(existing.image))) {
    existing.image = meta.image;
    changed = true;
  }
  const hasNewDescription = meta.description && meta.description !== "暂无摘要";
  const descriptionIsMissing = !existing.description || existing.description === "暂无摘要";
  if (!descriptionLocked && hasNewDescription && meta.description !== existing.description && (isYouTube || descriptionIsMissing)) {
    existing.description = meta.description;
    changed = true;
  }
  return changed;
}

// 一条收藏的信息是不是「不完整」（缺封面或摘要）。收尾时用它提醒用户哪几篇没抓全。
// 注意是看「最终存下来的状态」，而不是「这次抓取有没有成功」——
// 否则一条本来就有封面摘要的旧收藏，只是这次抓取失败，也会被误报成「没抓全」。
function isIncomplete(record: Partial<PageMetadata> | null | undefined): boolean {
  return !record?.image || !record?.description || record.description === "暂无摘要";
}

// 一眼就能看出是「站点图标」而不是内容封面的图片地址。
// 用于两处：① 触发服务端兜底（见 refetchMetaFromServer）；② 允许重复收藏时
// 用真正的封面把存成图标的旧封面替换掉。
function isIconLikeImage(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const file = new URL(url).pathname.split("/").pop()!.toLowerCase();
    return /^(favicon|apple-touch-icon|icon|logo)[.\-_@]/.test(file) || /^(favicon|icon|logo)\./.test(file);
  } catch {
    return false;
  }
}

export { mergeDuplicateMetadata, isIncomplete, isPlaceholderText, titleHasSiteNoise, isIconLikeImage };
