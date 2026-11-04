import type { StoredItem } from "../storage/contracts";

export type ItemLinkFormat = "url" | "markdown";
type LinkItem = Readonly<Pick<StoredItem, "title" | "url">>;

export function itemLinkText(item: LinkItem, format: ItemLinkFormat): string {
  const rawUrl = item.url ?? "";
  if (format === "url") return rawUrl;
  const title = (item.title?.trim() || rawUrl).replace(/\s+/g, " ").replace(/[\\`*_[\]]/g, "\\$&");
  // 保留查询参数、片段和已有编码，只转义会打断 Markdown 链接目标的字符。
  const url = rawUrl.replace(/[\\\s()<>]/gu, character => character === "(" ? "%28" : character === ")" ? "%29" : encodeURIComponent(character));
  return `[${title}](${url})`;
}

export async function copyItemLink(item: LinkItem, format: ItemLinkFormat): Promise<boolean> {
  if (!item.url) return false;
  try {
    await navigator.clipboard.writeText(itemLinkText(item, format));
    return true;
  } catch { return false; }
}
