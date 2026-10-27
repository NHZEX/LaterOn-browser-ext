import { browser } from "wxt/browser";
import { projectPickerFolders, typingTarget } from "./shared";
import { SIDEBAR_WIDTH } from "./page";
import type { LibraryControls } from "./useLibraryControls";
import type { LibrarySnapshot } from "./page";
import type { DialogService } from "../ui/dialog.js";
import { openFolderPicker } from "../picker/ui.js";
import { loadDialog } from "../ui/load-dialog";
import { bindStorageFeedback } from "../storage/page-feedback";
import { t } from "../shared/i18n";

export type LibraryDialog = DialogService;
export function bindPageAdapters(controls: LibraryControls): { mount: () => void; dispose: () => void } {
  const { commands, bulk, projects, collection } = controls;
  let alive = true;
  let openedDialog: LibraryDialog | undefined;
  // The library already imports the stylesheet through its native HTML entry.
  const loadLibraryDialog = async (): Promise<LibraryDialog> => {
    const api = await loadDialog(false);
    openedDialog = api;
    return api;
  };
  commands.bind({ storage: globalThis.LaterOnStorage, translate: t, toast: controls.notice.show, navigate: controls.project,
    accept: controls.storage.accept,
    prompt: async config => { const api = await loadLibraryDialog(); return alive ? api.prompt(config) : false; },
    confirm: async config => { const api = await loadLibraryDialog(); return alive ? api.confirm(config) : false; },
    closeDialog: () => openedDialog?.close(),
    pick: request => openFolderPicker({ ...request, theme: controls.preferences.value.theme || "system",
      language: document.documentElement.lang, folders: projectPickerFolders(collection.value, t) }) });
  bulk.bind({ translate: t, toast: controls.notice.show, mutate: commands.mutate, confirm: commands.confirm,
    pick: request => openFolderPicker({ ...request, theme: controls.preferences.value.theme || "system",
      language: document.documentElement.lang, folders: projectPickerFolders(collection.value, t),
      onPick: (id, name) => request.onPick(id || "", name),
      onCreateProject: name => request.current() ? projects.createFromPicker(name) : null }),
    openWindow: urls => browser.windows.create({ url: [...urls], focused: true, type: "normal" }) });
  const keydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      if (controls.menu.value) controls.closeMenu();
      else if (controls.state.renamingId) controls.cancelRename();
    } else if (event.key === "F2" && !typingTarget(event.target) && collection.value.projects.some(project => project.id === controls.state.activeProject)) {
      event.preventDefault(); controls.rename(controls.state.activeProject);
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault(); document.querySelector<HTMLElement>("#searchInput")?.focus();
    }
  };
  const stopFeedback = bindStorageFeedback(loadLibraryDialog);
  function mount(): void {
    document.addEventListener("keydown", keydown);
  }
  function dispose(): void { alive = false; stopFeedback(); openedDialog?.dispose(); document.removeEventListener("keydown", keydown); }
  return { mount, dispose };
}

export function bindSidebar(controls: Pick<LibraryControls, "sidebar">, snapshot: LibrarySnapshot): void {
  controls.sidebar.bind({ saved: snapshot[SIDEBAR_WIDTH], save: width => browser.storage.local.set({ [SIDEBAR_WIDTH]: width }),
    subscribe: notify => {
      const listener: Parameters<typeof browser.storage.onChanged.addListener>[0] = (changes, area) => {
        if (area === "local" && changes[SIDEBAR_WIDTH]) notify(changes[SIDEBAR_WIDTH].newValue);
      };
      browser.storage.onChanged.addListener(listener);
      return () => browser.storage.onChanged.removeListener?.(listener);
    } });
}

export async function openLibrarySettings(event: MouseEvent, current: () => boolean): Promise<void> {
  const url = browser.runtime.getURL("/settings.html");
  // 默认沿用当前标签，设置页返回即可回到收藏墙；修饰键仍打开新标签。
  if (event.metaKey || event.ctrlKey || event.shiftKey) { if (current()) await browser.tabs.create({ url }); return; }
  const tab = await browser.tabs.getCurrent();
  if (!current()) return;
  if (tab?.id) await browser.tabs.update(tab.id, { url });
  else await browser.tabs.create({ url });
}
