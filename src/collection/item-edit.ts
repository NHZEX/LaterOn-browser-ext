import type { ItemChanges, StoredItem } from "../storage/contracts";

export type EditableItem = Readonly<Pick<StoredItem, "title" | "description" | "image">>;
export type ItemEditPatch = Pick<ItemChanges, "title" | "description" | "cover" | "titleEdited" | "descriptionEdited" | "imageEdited">;

export interface ItemEditValues {
  readonly title?: string | null;
  readonly description?: string | null;
  readonly cover?: string | null;
}

const NO_SUMMARY = "暂无摘要";

export function isEmptySummary(description: string | null | undefined): boolean {
  return typeof description === "string" && /^\s*(暂无摘要|No summary)?\s*$/i.test(description);
}

/** Resolve the stored image pointer against the caller's current cover snapshot. */
export function resolveImage(item: Pick<EditableItem, "image"> | null | undefined, covers: Readonly<Record<string, string>>): string {
  const image = item?.image;
  if (typeof image !== "string" || !image) return "";
  return image.startsWith("local://") ? covers[image.slice(8)] || "" : image;
}

/** Compare form values with the item and resolved cover captured when editing began. */
export function buildEditPatch(item: EditableItem, values: ItemEditValues, originalCover: string): ItemEditPatch {
  const title = (values.title ?? item.title ?? "").trim();
  const description = (values.description ?? item.description ?? "").trim() || NO_SUMMARY;
  return {
    ...(title && title !== item.title ? { title, titleEdited: true } : {}),
    ...(description !== item.description ? { description, descriptionEdited: true } : {}),
    ...(typeof values.cover === "string" && values.cover !== originalCover ? { cover: values.cover, imageEdited: true } : {})
  };
}
