import { buildEditPatch, isEmptySummary } from "../collection/item-edit";
import { captureCardDeletion, editableCard, groupCover } from "../sync/projection";
import { nextStatus, normalizeItemState } from "../collection/item-state";
import type { ItemChanges } from "../storage/contracts";
import { editRecoveryNotice } from "../storage/edit-recovery";
import type { SidepanelControls } from "./useSidepanelControls";
import type { PanelCommands } from "./usePanelCommands";
import { t } from "../shared/i18n";
import { copyItemLink, type ItemLinkFormat } from "../collection/item-link";

export function usePanelItems(controls: SidepanelControls, commands: PanelCommands) {
  function update(id: string, patch: ItemChanges) { return commands.execute("mutateItems", { operation: "update", ids: [id], patch }); }
  function read(id: string): Promise<void> {
    // 手动只切换未读 / 已完成；在读由打开文章进入，点过但没读完不算已读。
    return commands.perform(`item:${id}`, async () => {
      const item = commands.find(id);
      if (item) await update(id, { status: nextStatus(normalizeItemState(item).status) });
    });
  }
  function edit(id: string): Promise<void> {
    return commands.perform(`item:${id}`, async () => {
      const member = commands.find(id); if (!member) return;
      const { item, basis: editBasis } = editableCard(member, controls.collection.value.groups);
      // 封面可能是远程 URL、local://id 独立本体或旧 data: 数据，共享解析保留三种兼容。
      const { source: cover, id: coverOwner } = groupCover(item, controls.covers.value, controls.collection.value.groups);
      const result = await commands.dialog(api => api.prompt({ title: t("editItem"),
        message: isEmptySummary(item.description) ? t("missingSummaryHint") : "",
        // 共享弹窗压缩上传图片或移除封面，协调器原子保存封面与指针。
        cover: { name: "cover", label: t("cover"), value: cover }, fields: [
          { name: "title", label: t("title"), value: item.title ?? "", maxLength: 200 },
          { name: "url", label: t("pageUrl"), value: item.url, multiline: true, rows: 2, readOnly: true },
          { name: "description", label: t("summary"), value: isEmptySummary(item.description) ? "" : item.description ?? "",
            placeholder: t("summaryPlaceholder"), multiline: true, maxLength: 500 }
        ], confirmText: t("save") }), "dialogLoadFailed");
      if (!result || !result.ok || !commands.current()) return;
      const text = (key: string) => typeof result.values?.[key] === "string" ? result.values[key] : undefined;
      // 对比打开时快照，只提交用户改动；手工编辑标记防止重新收藏时被抓取结果覆盖。
      const patch = buildEditPatch(item, { title: text("title"), description: text("description"), cover: text("cover") }, cover);
      if (!Object.keys(patch).length) return;
      const { cover: nextCover, imageEdited, ...textPatch } = patch;
      const itemPatch = coverOwner === id ? patch : textPatch;
      const saved = Object.keys(itemPatch).length
        ? await commands.execute("mutateItems", { operation: "update", ids: [id], patch: itemPatch, editBasis }) : null;
      if (coverOwner !== id && nextCover !== undefined && commands.current()) await update(coverOwner, { cover: nextCover, imageEdited });
      const notice = editRecoveryNotice(saved?.editConflict);
      if (notice) commands.notify(notice, "toast");
    });
  }
  function remove(id: string): Promise<void> {
    return commands.perform(`item:${id}`, async () => {
      const item = commands.find(id); if (!item) return;
      const target = captureCardDeletion([id], controls.collection.value.groups);
      // 删除不可撤销，始终先确认；弹窗加载失败保留收藏，长标题截断以免撑高确认框。
      const raw = item.title?.trim() || t("itemFallback");
      const confirmed = await commands.dialog(api => api.confirm({ tone: "danger",
        title: t("deleteItemTitle", { title: raw.length > 26 ? `${raw.slice(0, 26)}…` : raw }),
        message: t("deleteCannotUndo"), confirmText: t("delete") }), "operationFailed");
      if (confirmed && commands.current()) await commands.execute("mutateItems", { operation: "delete", ...target });
    });
  }
  async function copy(id: string, format: ItemLinkFormat): Promise<void> {
    const item = commands.find(id);
    if (!item || !commands.current()) return;
    const copied = await copyItemLink(item, format);
    if (commands.current()) commands.notify(copied ? "linkCopied" : "linkCopyFailed", "toast");
  }
  return { update, read, edit, remove, copy };
}
export type PanelItems = ReturnType<typeof usePanelItems>;
