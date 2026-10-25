import type { ItemChanges, StoredItem } from "../storage/contracts";

export type EditableItem = Readonly<Pick<StoredItem, "title" | "description" | "image">>;
export type ItemEditPatch = Pick<ItemChanges, "title" | "description" | "cover" | "titleEdited" | "descriptionEdited" | "imageEdited">;

export interface ItemEditValues {
  readonly title?: string | null;
  readonly description?: string | null;
  readonly cover?: string | null;
}

const NO_SUMMARY = "暂无摘要";

// 抓取失败留下的摘要占位在编辑框中视为空，便于用户直接补写。
export function isEmptySummary(description: string | null | undefined): boolean {
  return typeof description === "string" && /^\s*(暂无摘要|No summary)?\s*$/i.test(description);
}

/** Resolve the stored image pointer against the caller's current cover snapshot. */
// image 兼容远程网址、local://<id> 本地封面指针和待迁移的旧 data URL；本地图像从独立 covers 键读取。
export function resolveImage(item: Pick<EditableItem, "image"> | null | undefined, covers: Readonly<Record<string, string>>): string {
  const image = item?.image;
  if (typeof image !== "string" || !image) return "";
  return image.startsWith("local://") ? covers[image.slice(8)] || "" : image;
}

/** Compare form values with the item and resolved cover captured when editing began. */
// 只提交相对打开时快照变化的字段，保留其它页面对未编辑字段的更新。
// titleEdited / descriptionEdited 防止再次收藏时自动抓取覆盖手写内容；cover 为空表示主动移除封面。
export function buildEditPatch(item: EditableItem, values: ItemEditValues, originalCover: string): ItemEditPatch {
  const title = (values.title ?? item.title ?? "").trim();
  const description = (values.description ?? item.description ?? "").trim() || NO_SUMMARY;
  return {
    ...(title && title !== item.title ? { title, titleEdited: true } : {}),
    ...(description !== item.description ? { description, descriptionEdited: true } : {}),
    ...(typeof values.cover === "string" && values.cover !== originalCover ? { cover: values.cover, imageEdited: true } : {})
  };
}
