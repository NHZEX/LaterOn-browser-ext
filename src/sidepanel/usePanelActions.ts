import { shallowRef } from "vue";
import { cardTarget } from "../shared/card-media";
import { usePanelCommands } from "./usePanelCommands";
import { usePanelItems } from "./usePanelItems";
import { usePanelReader } from "./usePanelReader";
import { usePanelDrag } from "./usePanelDrag";
import type { SidepanelControls } from "./useSidepanelControls";

export interface PanelMenuRequest { readonly id: string; readonly x: number; readonly y: number; readonly trigger: HTMLElement }
export type PanelMenuAction = "open" | "edit" | "delete";

export function usePanelActions(controls: SidepanelControls) {
  const commands = usePanelCommands(controls);
  const items = usePanelItems(controls, commands);
  const reader = usePanelReader(controls, commands, items);
  const drag = usePanelDrag(controls, commands);
  const menu = shallowRef<PanelMenuRequest | null>(null);
  function closeMenu(): void { menu.value = null; }
  function click(event: MouseEvent, id: string): void {
    // 各平台拖后 click 抑制不一致，再兜底 250ms，避免松手排序时误开文章。
    if (drag.suppressClick()) { event.preventDefault(); event.stopPropagation(); return; }
    if (!(event.target instanceof Element)) return;
    if (event.target.closest(".delete")) void items.remove(id);
    else if (event.target.closest(".edit")) void items.edit(id);
    else if (event.target.closest(".read-toggle")) void items.read(id);
    else if (event.target.closest(".open-item")) {
      // 真实链接的 Ctrl/⌘/Shift/Alt 点击交还浏览器，保留原生新标签 / 新窗口语义。
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); void reader.open(id);
    }
  }
  function openMenu(event: MouseEvent | KeyboardEvent, id: string): void {
    if (!(event.target instanceof Element) || !event.target.closest(".open-item")) return;
    if (event instanceof KeyboardEvent && event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
    if (!cardTarget(commands.find(id)?.url)) return;
    event.preventDefault(); event.stopPropagation();
    const trigger = event.target.closest<HTMLElement>(".open-item");
    if (!trigger) return;
    const box = trigger.getBoundingClientRect();
    // 封面与文字是同一个网页入口，用自己的菜单避免图片 / 选中文字等无关动作。
    menu.value = { id, trigger, x: event instanceof MouseEvent ? event.clientX : box.right,
      y: event instanceof MouseEvent ? event.clientY : box.bottom };
  }
  function pick(action: PanelMenuAction, id: string): void {
    if (action === "open") void reader.newTab(id);
    else if (action === "edit") void items.edit(id);
    else void items.remove(id);
  }
  function dispose(): void { closeMenu(); drag.dispose(); reader.dispose(); commands.dispose(); }
  return { commands, items, reader, drag, menu, closeMenu, openMenu, pick, click, dispose };
}
export type PanelActions = ReturnType<typeof usePanelActions>;
