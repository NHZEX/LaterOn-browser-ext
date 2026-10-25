import { watch } from "vue";
import { projectEditOptions, projectEditChanges } from "./shared";
import type { LibraryCommands } from "./useLibraryCommands";

interface ProjectState { activeProject: string; renamingId: string | null; renameDraft: string }

export function useLibraryProjects(state: ProjectState, commands: LibraryCommands, closeMenu: () => void) {
  const find = (id: string) => commands.collection.value.projects.find(project => project.id === id);
  const { t, toast, execute } = commands;
  let renameSession = 0;
  function cancelRename(): void { renameSession++; state.renamingId = null; state.renameDraft = ""; }
  function rename(id: string): void {
    const project = find(id);
    if (!project) return;
    closeMenu(); cancelRename(); state.renamingId = id; state.renameDraft = project.name ?? "";
  }
  async function commitRename(id: string, value: string): Promise<void> {
    // Escape 或先前提交已结束本轮改名时忽略随后触发的 blur，避免旧值再次写回。
    if (state.renamingId !== id) return;
    const name = value.trim();
    const project = find(id);
    cancelRename();
    if (!project || !name || name === project.name) return;
    if (commands.collection.value.projects.some(entry => entry.id !== id && entry.name === name)) { toast("projectExists", { name }); return; }
    const session = renameSession;
    await commands.perform(`project:${id}`, async () => {
      const result = await execute("updateProject", { id, changes: { name } });
      if (result) toast("renamedTo", { name });
      // 写失败只恢复原改名会话的草稿，不覆盖用户后来开启的改名或已被外部删除的项目。
      else if (commands.current() && renameSession === session && find(id) && !state.renamingId) {
        state.renamingId = id; state.renameDraft = value;
      }
    });
  }
  async function createFromPicker(name: string) {
    const result = await execute("createProject", { name: name.trim() }, "createProjectFailed");
    // 共享选择器要求项目对象 { id, name }，不能返回存储命令的 { ok, project } 包装。
    return result?.project ?? null;
  }
  function create(): Promise<void> {
    return commands.perform("create-project", async () => {
      const result = await commands.prompt({ title: t("newProject"), message: t("newProjectHint"),
        fields: [{ name: "name", label: t("projectNameLabel"), placeholder: t("projectNamePlaceholder"), maxLength: 28 }], confirmText: t("create") });
      const name = result?.ok && typeof result.values?.name === "string" ? result.values.name.trim() : "";
      if (!commands.current() || !name) return;
      const response = await execute("createProject", { name }, "createProjectFailed");
      if (!response?.project) return;
      commands.navigate(response.project.id);
      toast(response.existed ? "projectExists" : "projectCreated", { name: response.project.name ?? name });
    }, "createProjectFailed");
  }
  function edit(id: string): Promise<void> {
    return commands.perform(`project:${id}`, async () => {
      const project = find(id);
      if (!project) return;
      const options = projectEditOptions(commands.collection.value, project, t);
      const result = await commands.prompt(options);
      if (!result?.ok || !commands.current() || !find(id)) return;
      const changes = projectEditChanges(commands.collection.value, project, options.cover?.value ?? "", result.values ?? {});
      if (!Object.keys(changes).length) return;
      if (changes.name && commands.collection.value.projects.some(entry => entry.id !== id && entry.name === changes.name)) { toast("duplicateProject"); return; }
      if (!await execute("updateProject", { id, changes })) return;
      // 保存提示仅列出实际修改的名称、简介、封面或组合。
      const changed = [changes.name !== undefined ? t("projectUpdateName") : "", changes.note !== undefined ? t("projectUpdateNote") : "",
        changes.cover !== undefined ? t("projectUpdateCover") : "", changes.coverPick !== undefined ? t("projectUpdateCollage") : ""].filter(Boolean).join(" · ");
      toast(changes.name ? "projectUpdated" : "projectChangesSaved", { name: changes.name ?? project.name ?? "", changes: changed });
    });
  }
  function pin(id: string): Promise<void> {
    // 置顶分组及取消后的原普通区位置由协调器维护，页面直接接受响应顺序，不自行重排。
    return commands.perform(`project:${id}`, async () => {
      const project = find(id); if (!project) return;
      const result = await execute("setProjectPinned", { id, pinned: !project.pinned });
      if (result?.project) toast(result.project.pinned ? "pinDone" : "unpinDone", { name: result.project.name ?? "" });
    });
  }
  function archive(id: string): Promise<void> {
    return commands.perform(`project:${id}`, async () => {
      const project = find(id); if (!project) return;
      const archived = !project.archived;
      if (!await execute("updateProject", { id, changes: { archived } })) return;
      commands.navigate(archived ? "archive" : id);
      toast(archived ? "projectArchived" : "projectRestored");
    });
  }
  function remove(id: string): Promise<void> {
    return commands.perform(`project:${id}`, async () => {
      const project = find(id); if (!project) return;
      const count = commands.collection.value.items.filter(item => item.projectId === id).length;
      if (!await commands.confirm({ tone: "danger", title: t("deleteProjectTitle", { name: project.name ?? "" }),
        message: count ? t("deleteProjectItems", { n: count }) : t("deleteEmptyProject"), confirmText: t("deleteProject") })) return;
      if (!commands.current() || !find(id)) return;
      // 确认中的数量只用于提示；实际删除及封面、顺序等清理由协调器按最新集合原子完成。
      const result = await execute("deleteProject", { id });
      if (!result) return;
      if (state.activeProject === id) commands.navigate("all");
      toast(result.affected ? "projectDeletedWithItems" : "projectDeleted", { name: project.name ?? "", n: result.affected ?? 0 });
    });
  }
  const stopCollection = watch(commands.collection, () => { if (state.renamingId && !find(state.renamingId)) cancelRename(); }, { flush: "sync" });
  function dispose(): void { stopCollection(); cancelRename(); }
  return { rename, cancelRename, commitRename, create, createFromPicker, edit, pin, archive, remove, dispose };
}
