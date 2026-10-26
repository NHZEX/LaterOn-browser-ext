import { computed, shallowRef, watch } from "vue";
import { browser } from "wxt/browser";
import { normalize, unwrapSuspendedTab } from "../shared/url-utils";
import { t } from "../shared/i18n";
import { ACTIVE, CURRENT } from "../storage/contracts";
import { normalizePanelProject } from "./shared";
import type { PageMetadata } from "./page";
import type { SidepanelControls } from "./useSidepanelControls";

interface MetadataResponse { readonly ok?: boolean; readonly metadata?: Partial<PageMetadata> }
interface SaveResponse { readonly ok?: boolean; readonly pending?: boolean; readonly error?: string }

export function usePanelCurrent(controls: SidepanelControls) {
  const metadata = shallowRef<PageMetadata | null>(null);
  const error = shallowRef("");
  const saving = shallowRef(false), confirmed = shallowRef(false);
  const matched = computed(() => {
    const url = metadata.value && normalize(metadata.value.url);
    return url ? controls.collection.value.items.find(item => normalize(item.url ?? "") === url) : undefined;
  });
  const saved = computed(() => confirmed.value || !!matched.value);
  const disabled = computed(() => !metadata.value || saving.value || saved.value);
  let alive = true, generation = 0, tabId: number | undefined;
  const waits = new Set<() => void>();

  // 元数据抓取可挂起；先显示标签页资料，4 秒后停止等待，卸载也须释放等待者。
  function extract(id: number): Promise<MetadataResponse | null> {
    return new Promise(resolve => {
      const finish = (value: MetadataResponse | null): void => { clearTimeout(timer); waits.delete(cancel); resolve(value); };
      const cancel = (): void => finish(null);
      const timer = setTimeout(cancel, 4000);
      waits.add(cancel);
      void browser.runtime.sendMessage({ type: "EXTRACT_METADATA", tabId: id }).then(finish, cancel);
    });
  }
  function sync(followProject = false): void {
    if (!alive || !metadata.value) return;
    // 与全屏共用网址规则：忽略追踪参数和普通锚点，保留 #/、#!/ 业务路由。
    const item = matched.value;
    const id = item?.id ?? null;
    if (controls.currentId.value !== id) void browser.storage.local.set({ [CURRENT]: id }).catch(() => {});
    controls.locate(id);
    if (!item) { window.scrollTo({ top: 0, behavior: "auto" }); return; }
    // 切换标签页先切到文章所属项目，卡片才不会被旧目录挡住；迟到资料只补文字。
    const project = normalizePanelProject(item.projectId, controls.collection.value.projects);
    if (followProject && controls.state.project !== project) {
      controls.state.project = project;
      void browser.storage.local.set({ [ACTIVE]: project }).catch(() => {});
    }
  }
  async function load(): Promise<void> {
    const token = ++generation;
    metadata.value = null; error.value = ""; confirmed.value = false; saving.value = false;
    tabId = undefined; controls.message.value = "";
    try {
      const [active] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!alive || token !== generation) return;
      const tab = active && unwrapSuspendedTab(active);
      if (!tab?.id) throw new Error(t("noCurrentPage"));
      if (!/^https?:/i.test(tab.url ?? "")) throw new Error(t(tab.url?.startsWith("file:") ? "localFileUnsupported" : "browserPageUnsupported"));
      const url = tab.url ?? "";
      const fallback: PageMetadata = { url, title: tab.title || url, description: t("noDescription"),
        source: new URL(url).hostname.replace(/^www\./, ""), image: "", favicon: tab.favIconUrl ?? "" };
      tabId = tab.id; metadata.value = fallback; sync(true);
      const response = await extract(tab.id);
      if (!alive || token !== generation || !response?.ok || !response.metadata) return;
      metadata.value = { ...fallback, ...response.metadata, title: response.metadata.title || fallback.title, url };
      sync();
    } catch (cause) { if (alive && token === generation) error.value = cause instanceof Error ? cause.message : t("noCurrentPage"); }
  }
  async function save(): Promise<void> {
    if (!alive || disabled.value || tabId === undefined) return;
    const token = generation;
    saving.value = true;
    // 与快捷键共用后台链路，尊重「收藏前先选项目」；固定标签页，避免查询期间切页收藏错对象。
    const response: SaveResponse | null = await browser.runtime.sendMessage({ type: "QUICK_SAVE_TAB", source: "panel", tabId }).catch(() => null);
    if (!alive || token !== generation) return;
    saving.value = false;
    if (response?.ok && response.pending) { controls.message.value = t("pickerOpened"); return; }
    if (response?.ok) { confirmed.value = true; controls.message.value = ""; return; }
    controls.message.value = response?.error || t("saveFailed");
  }
  const activated = (): void => { void load(); };
  const updated: Parameters<typeof browser.tabs.onUpdated.addListener>[0] = (_id, change, tab) => {
    if (tab.active && (change.status === "complete" || change.url)) void load();
  };
  function mount(): void { browser.tabs.onActivated.addListener(activated); browser.tabs.onUpdated.addListener(updated); }
  const stopConfirmation = watch(() => controls.collection.value.items, () => { confirmed.value = false; }, { flush: "sync" });
  function dispose(): void {
    stopConfirmation();
    alive = false; generation++; waits.forEach(cancel => cancel());
    browser.tabs.onActivated.removeListener(activated); browser.tabs.onUpdated.removeListener(updated);
  }
  return { metadata, error, saving, saved, disabled, load, sync, save, mount, dispose };
}
export type PanelCurrent = ReturnType<typeof usePanelCurrent>;
