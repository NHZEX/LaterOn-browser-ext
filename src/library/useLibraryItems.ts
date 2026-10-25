import { watch } from "vue";
import { buildEditPatch, isEmptySummary, resolveImage } from "../collection/item-edit";
import type { ItemChanges } from "../storage/contracts";
import type { LibraryCommands } from "./useLibraryCommands";
import { nextStatus, normalizeItemState } from "../collection/item-state";

export function useLibraryItems(commands: LibraryCommands, createProject: (name: string) => Promise<{ readonly id: string; readonly name?: string } | null>, clearSearch: () => void) {
  const find = (id: string) => commands.collection.value.items.find(item => item.id === id);
  const { t, toast } = commands;
  let picker: { readonly close: () => void } | undefined;
  let pickerVersion = 0;
  let pickerId: string | null = null;
  // 新浮层、外部删除和卸载都会使旧版本失效，旧回调不能移动收藏或新建项目。
  function closePicker(): void { pickerVersion++; picker?.close(); picker = undefined; pickerId = null; }
  function update(id: string, patch: ItemChanges) { return commands.mutate("update", [id], patch); }
  function read(id: string): Promise<void> {
    return commands.perform(`item:${id}`, async () => { const item = find(id); if (item) await update(id, { status: nextStatus(normalizeItemState(item).status) }); });
  }
  async function moveTo(id: string, projectId: string | null): Promise<void> {
    if (await update(id, { projectId })) clearSearch();
  }
  function edit(id: string): Promise<void> {
    return commands.perform(`item:${id}`, async () => {
      const item = find(id); if (!item) return;
      const cover = resolveImage(item, commands.collection.value.covers);
      // 摘要占位显示为空；共享弹窗负责上传压缩及移除，保存后由协调器同时写封面和指针。
      const result = await commands.prompt({ title: t("editItem"), message: isEmptySummary(item.description) ? t("missingSummaryHint") : "",
        cover: { name: "cover", label: t("cover"), value: cover }, fields: [
          { name: "title", label: t("title"), value: item.title ?? "", maxLength: 200 },
          { name: "description", label: t("summary"), value: isEmptySummary(item.description) ? "" : item.description ?? "",
            placeholder: t("summaryPlaceholder"), multiline: true, maxLength: 500 }], confirmText: t("save") });
      if (!result?.ok || !commands.current() || !find(id)) return;
      const text = (key: string) => typeof result.values?.[key] === "string" ? result.values[key] : undefined;
      // 用打开时的收藏和解析后的封面比较，只写用户改动并设置手工编辑保护标记。
      const patch = buildEditPatch(item, { title: text("title"), description: text("description"), cover: text("cover") }, cover);
      if (!Object.keys(patch).length) { toast("noChanges"); return; }
      if (await update(id, patch)) toast("changesSaved");
    });
  }
  function remove(id: string): Promise<void> {
    return commands.perform(`item:${id}`, async () => {
      const item = find(id); if (!item) return;
      // 删除不可撤销，先确认；长标题截断，避免把确认框撑成大段文字。
      const raw = item.title?.trim() || t("itemFallback");
      if (!await commands.confirm({ tone: "danger", title: t("deleteItemTitle", { title: raw.length > 26 ? `${raw.slice(0, 26)}…` : raw }),
        message: t("deleteCannotUndo"), confirmText: t("delete") })) return;
      if (commands.current() && find(id) && await commands.mutate("delete", [id])) toast("itemDeleted");
    });
  }
  function move(id: string, anchor: HTMLElement): void {
    // 复用收藏网页时的项目选择器，锚定卡片控件；选择 / 新建成功后直接修改所属项目。
    const item = find(id); if (!item || !commands.current()) return;
    closePicker();
    pickerId = id;
    const version = pickerVersion;
    const current = () => commands.current() && pickerVersion === version && !!find(id);
    picker = commands.pick({ anchor, selected: item.projectId || "", onCreateProject: name => current() ? createProject(name) : Promise.resolve(null),
      onPick: async (projectId, name) => {
        if (!current()) return { ok: false, error: t("operationFailed") };
        // 显式返回失败让浮层保留并允许重试；成功才退出搜索并关闭浮层。
        if (!await update(id, { projectId: projectId || null })) return { ok: false, error: t("operationFailed") };
        if (current()) { clearSearch(); toast(projectId ? "movedTo" : "movedToInbox", { name }); }
        return { ok: true };
      } });
  }
  const stopCollection = watch(commands.collection, () => { if (picker && pickerId && !find(pickerId)) closePicker(); }, { flush: "sync" });
  function dispose(): void { stopCollection(); closePicker(); }
  return { update, read, edit, remove, move, moveTo, dispose };
}

export type LibraryItems = ReturnType<typeof useLibraryItems>;
