import { buildEditPatch, isEmptySummary, resolveImage } from "../collection/item-edit";
import { nextStatus, normalizeItemState } from "../collection/item-state";
import type { ItemChanges } from "../storage/contracts";
import type { SidepanelControls } from "./useSidepanelControls";
import type { PanelCommands } from "./usePanelCommands";
import { t } from "../shared/i18n";

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
      const item = commands.find(id); if (!item) return;
      // 封面可能是远程 URL、local://id 独立本体或旧 data: 数据，共享解析保留三种兼容。
      const cover = resolveImage(item, controls.covers.value);
      const result = await commands.dialog(api => api.prompt({ title: t("editItem"),
        message: isEmptySummary(item.description) ? t("missingSummaryHint") : "",
        // 共享弹窗压缩上传图片或移除封面，协调器原子保存封面与指针。
        cover: { name: "cover", label: t("cover"), value: cover }, fields: [
          { name: "title", label: t("title"), value: item.title ?? "", maxLength: 200 },
          { name: "description", label: t("summary"), value: isEmptySummary(item.description) ? "" : item.description ?? "",
            placeholder: t("summaryPlaceholder"), multiline: true, maxLength: 500 }
        ], confirmText: t("save") }), "dialogLoadFailed");
      if (!result || !result.ok || !commands.current() || !commands.find(id)) return;
      const text = (key: string) => typeof result.values?.[key] === "string" ? result.values[key] : undefined;
      // 对比打开时快照，只提交用户改动；手工编辑标记防止重新收藏时被抓取结果覆盖。
      const patch = buildEditPatch(item, { title: text("title"), description: text("description"), cover: text("cover") }, cover);
      if (Object.keys(patch).length) await update(id, patch);
    });
  }
  function remove(id: string): Promise<void> {
    return commands.perform(`item:${id}`, async () => {
      const item = commands.find(id); if (!item) return;
      // 删除不可撤销，始终先确认；弹窗加载失败保留收藏，长标题截断以免撑高确认框。
      const raw = item.title?.trim() || t("itemFallback");
      const confirmed = await commands.dialog(api => api.confirm({ tone: "danger",
        title: t("deleteItemTitle", { title: raw.length > 26 ? `${raw.slice(0, 26)}…` : raw }),
        message: t("deleteCannotUndo"), confirmText: t("delete") }), "operationFailed");
      if (confirmed && commands.current() && commands.find(id)) await commands.execute("mutateItems", { operation: "delete", ids: [id] });
    });
  }
  return { update, read, edit, remove };
}
export type PanelItems = ReturnType<typeof usePanelItems>;
