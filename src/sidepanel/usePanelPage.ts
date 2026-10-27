import { watch } from "vue";
import { normalizeItems } from "../collection/item-state";
import { t, ready, applyStatic } from "../shared/i18n";
import { ITEMS } from "../storage/contracts";
import { usePanelCache } from "./usePanelCache";
import { panelNow, usePanelDiagnostics } from "./usePanelDiagnostics";
import { usePanelStorage } from "./usePanelStorage";
import { usePanelCurrent } from "./usePanelCurrent";
import { usePanelBrowser } from "./usePanelBrowser";
import type { BootSegments } from "./page";
import type { SidepanelControls } from "./useSidepanelControls";
import type { PanelCommands } from "./usePanelCommands";

export function usePanelPage(controls: SidepanelControls, commands: PanelCommands) {
  const cache = usePanelCache(() => controls.collection.value);
  const diagnostics = usePanelDiagnostics(cache, () => controls.collection.value.items.length);
  const current = usePanelCurrent(controls);
  const storage = usePanelStorage(controls, () => current.sync());
  const navigation = usePanelBrowser(controls);
  let alive = true;
  const previousToast = globalThis.showToast;
  const notify = (message: string): void => { if (alive) controls.message.value = message; };
  const frames = new Set<number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  function hideBoot(): void {
    document.querySelector("#bootSkeleton")?.remove(); document.querySelector("#bootTip")?.remove();
    document.body.classList.remove("booting"); globalThis.LaterOnBoot?.done();
  }
  function nextFrame(callback: () => void): void {
    const id = requestAnimationFrame(() => { frames.delete(id); if (alive) callback(); }); frames.add(id);
  }
  async function init(): Promise<void> {
    const start = globalThis.LaterOnBoot?.t0 ?? panelNow();
    const seg: BootSegments = { page: Math.round(panelNow() - start), cache: 0, paint: 0, data: 0, migrate: 0 };
    // 语言是独立读取，不能阻塞缓存首屏，也不能算入「准备页面」。
    void ready.then(() => { if (alive) applyStatic(); });
    // 先发出完整存储请求再同步读缓存，两者并行；封面大，留到首屏后单独读。
    const dataStart = panelNow();
    const stored = storage.read().then(snapshot => ({ snapshot }), cause => ({ error: String(cause?.message || cause) }));
    const cacheStart = panelNow(), cached = cache.read();
    seg.cache = Math.round(panelNow() - cacheStart);
    if (seg.cache > 400) cache.disable(); // 慢 localStorage 本次不再碰，避免反复叠加卡顿。
    const hit = !!cached?.length;
    if (hit) {
      const paint = panelNow();
      controls.collection.value = { ...controls.collection.value, items: normalizeItems(cached) };
      controls.ready.value = true;
      await controls.afterPaint();
      if (!alive) return;
      seg.paint = Math.round(panelNow() - paint);
    }
    globalThis.LaterOnBoot?.stage(t("readingSaves"));
    const result = await stored;
    if (!alive) return;
    seg.data = Math.round(panelNow() - dataStart);
    const migrate = panelNow();
    if ("error" in result) { seg.error = result.error; storage.failed(); }
    else { seg.bytes = JSON.stringify(result.snapshot[ITEMS] ?? []).length; await storage.restore(result.snapshot); }
    if (!alive) return;
    seg.migrate = Math.round(panelNow() - migrate);
    const paint = panelNow();
    await controls.afterPaint();
    if (!alive) return;
    if (!hit) seg.paint = Math.round(panelNow() - paint);
    diagnostics.report(seg, start, hit);
    navigation.markReady();
    controls.locate(controls.currentId.value);
    if (!("error" in result)) void storage.loadCovers();
    void current.load();
    if ("error" in result) controls.message.value = t(hit ? "noRefreshShowingCache" : "loadFailedRetry");
  }
  controls.connect(hideBoot);
  commands.bind({ accept: storage.accept, customSort: () => { controls.collection.value = { ...controls.collection.value, sortMode: "custom" }; }, setCurrent: controls.locate });
  // 写快照是给下一次打开用的，Vue 更新提交后再安排，不占当前绘制。
  const stopCache = watch([controls.collection, controls.covers], () => { if (controls.ready.value) cache.schedule(); }, { flush: "post" });
  function mount(): void {
    globalThis.showToast = notify;
    storage.mount(); navigation.mount(); current.mount();
    // 两帧让骨架真正画出来；无 rAF 的宿主保留定时降级。
    if (typeof requestAnimationFrame === "function") nextFrame(() => nextFrame(() => { void init(); }));
    else timer = setTimeout(() => { if (alive) void init(); }, 16);
  }
  function dispose(): void {
    alive = false; clearTimeout(timer); frames.forEach(id => cancelAnimationFrame(id)); frames.clear();
    if (globalThis.showToast === notify) globalThis.showToast = previousToast;
    stopCache(); storage.dispose(); navigation.dispose(); current.dispose(); cache.dispose();
  }
  return { current, navigation, banner: diagnostics.banner, mount, dispose };
}
