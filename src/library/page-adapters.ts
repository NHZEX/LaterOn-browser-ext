import { browser } from "wxt/browser";
import { projectPickerFolders, typingTarget } from "./shared";
import { SIDEBAR_WIDTH } from "./page";
import type { LibraryControls } from "./useLibraryControls";
import type { LibrarySnapshot } from "./page";
import type { LibraryCommands, ItemPickerRequest } from "./useLibraryCommands";
import { t } from "../shared/i18n";

type CommandBoundary = Parameters<LibraryCommands["bind"]>[0];
export type LibraryDialog = Pick<CommandBoundary, "prompt" | "confirm"> & {
  readonly close: () => void;
  readonly alert: (config: { tone: "danger"; title: string; message: string }) => Promise<unknown>;
};
interface FolderPickerOptions {
  readonly anchor: HTMLElement;
  readonly selected: string;
  readonly titleText?: string;
  readonly theme: string;
  readonly language: string;
  readonly folders: ReturnType<typeof projectPickerFolders>;
  readonly onPick: ItemPickerRequest["onPick"];
  readonly onCreateProject: (name: string) => ReturnType<ItemPickerRequest["onCreateProject"]> | null;
}
declare global { interface Window { openFolderPicker: (options: FolderPickerOptions) => { readonly close: () => void } } }

export function bindPageAdapters(controls: LibraryControls): { mount: () => void; dispose: () => void } {
  const { commands, bulk, projects, collection } = controls;
  commands.bind({ storage: globalThis.LaterOnStorage, translate: t, toast: controls.notice.show, navigate: controls.project,
    accept: controls.storage.accept,
    prompt: config => globalThis.LaterOnDialog!.prompt(config), confirm: config => globalThis.LaterOnDialog!.confirm(config),
    closeDialog: () => globalThis.LaterOnDialog?.close(),
    pick: request => window.openFolderPicker({ ...request, theme: controls.preferences.value.theme || "system",
      language: document.documentElement.lang, folders: projectPickerFolders(collection.value, t) }) });
  bulk.bind({ translate: t, toast: controls.notice.show, mutate: commands.mutate, confirm: commands.confirm,
    pick: request => window.openFolderPicker({ ...request, theme: controls.preferences.value.theme || "system",
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
  function mount(): void {
    document.addEventListener("keydown", keydown);
    globalThis.LaterOnI18n?.applyStatic();
  }
  function dispose(): void { document.removeEventListener("keydown", keydown); }
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
