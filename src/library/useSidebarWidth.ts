import type { Translate } from "../shared/i18n";

interface SidebarWidthEffects {
  readonly saved: unknown;
  readonly save: (width: number) => Promise<void>;
  readonly subscribe: (changed: (value: unknown) => void) => () => void;
}

export function useSidebarWidth(t: Translate) {
  let cleanup: (() => void) | undefined;
  let disposed = false;
  function bind(effects: SidebarWidthEffects): void {
    if (disposed) return;
    cleanup?.();
    const workspace = document.querySelector<HTMLElement>(".workspace");
    const handle = document.querySelector<HTMLElement>("#sidebarResizer");
    const controls = document.querySelector<HTMLElement>("#sidebarSizeControls");
    if (!workspace || !handle || !controls) return;
    const controller = new AbortController();
    const listen = { signal: controller.signal };
    const min = 240, normal = 280, max = 420;
    const normalize = (value: unknown): number => typeof value === "number" && Number.isFinite(value)
      ? Math.max(min, Math.min(max, Math.round(value))) : normal;
    let preferred = normalize(effects.saved);
    let resizing: { readonly pointerId: number; readonly x: number; readonly width: number; moved: boolean } | null = null;
    let ignoreClick = false;
    function apply(value: number): number {
      // 窄窗口给内容至少留 360px；仅限制显示值，保留宽窗口的偏好。
      const limit = Math.max(min, Math.min(max, (workspace!.clientWidth || window.innerWidth) - 360));
      const width = Math.min(normalize(value), limit);
      workspace!.style.setProperty("--sidebar-width", `${width}px`);
      handle!.setAttribute("aria-valuemin", String(min)); handle!.setAttribute("aria-valuemax", String(limit));
      handle!.setAttribute("aria-valuenow", String(width)); handle!.setAttribute("aria-valuetext", t("sidebarWidth", { n: width }));
      return width;
    }
    const current = (): number => Number(handle!.getAttribute("aria-valuenow"));
    function save(value: number): void {
      preferred = apply(value);
      void effects.save(preferred).catch(() => {});
    }
    function finish(cancelled = false): void {
      if (!resizing) return;
      const { pointerId, moved } = resizing;
      resizing = null;
      document.body.classList.remove("is-resizing-sidebar");
      if (handle!.hasPointerCapture?.(pointerId)) handle!.releasePointerCapture(pointerId);
      ignoreClick = moved;
      if (cancelled) apply(preferred); else if (moved) save(current());
    }
    handle.addEventListener("pointerdown", event => {
      if (event.button !== 0 || event.isPrimary === false || window.innerWidth <= 620 || resizing) return;
      event.preventDefault(); ignoreClick = false; controls.hidden = true; handle.focus({ preventScroll: true });
      resizing = { pointerId: event.pointerId, x: event.clientX, width: current(), moved: false };
      handle.setPointerCapture?.(event.pointerId); document.body.classList.add("is-resizing-sidebar");
    }, listen);
    handle.addEventListener("pointermove", event => {
      if (!resizing || event.pointerId !== resizing.pointerId) return;
      const delta = event.clientX - resizing.x;
      if (!resizing.moved && Math.abs(delta) < 3) return;
      resizing.moved = true; apply(resizing.width + delta);
    }, listen);
    handle.addEventListener("pointerup", event => { if (event.pointerId === resizing?.pointerId) finish(); }, listen);
    const cancel = (): void => finish(true);
    handle.addEventListener("pointercancel", cancel, listen);
    handle.addEventListener("lostpointercapture", cancel, listen);
    function toggle(): void { controls!.hidden = !controls!.hidden; }
    handle.addEventListener("click", () => { if (ignoreClick) { ignoreClick = false; return; } toggle(); }, listen);
    handle.addEventListener("dblclick", () => { controls.hidden = true; save(normal); }, listen);
    handle.addEventListener("keydown", event => {
      const step = event.shiftKey ? 32 : 8;
      const widths: Readonly<Record<string, number>> = { ArrowLeft: current() - step, ArrowRight: current() + step, Home: min, End: max, Enter: normal };
      const width = widths[event.key];
      if (width !== undefined) { event.preventDefault(); if (!resizing) save(width); }
      else if (event.key === " ") { event.preventDefault(); toggle(); }
    }, listen);
    controls.addEventListener("click", event => {
      if (!(event.target instanceof Element)) return;
      const action = event.target.closest<HTMLElement>("[data-sidebar-size]")?.dataset.sidebarSize;
      const widths: Readonly<Record<string, number>> = { narrower: current() - 24, wider: current() + 24, reset: normal };
      if (action && widths[action] !== undefined) save(widths[action]);
    }, listen);
    document.addEventListener("click", event => {
      if (event.target instanceof Node && !controls.contains(event.target) && !handle.contains(event.target)) controls.hidden = true;
    }, listen);
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      cancel(); if (controls.contains(document.activeElement)) handle.focus({ preventScroll: true }); controls.hidden = true;
    }, listen);
    window.addEventListener("blur", cancel, listen);
    // 窗口变化只重新约束显示值，不把窄屏结果覆盖为用户偏好。
    window.addEventListener("resize", () => { cancel(); controls.hidden = true; apply(preferred); }, listen);
    const unsubscribe = effects.subscribe(value => { if (!resizing) { preferred = normalize(value); apply(preferred); } });
    window.addEventListener("lateron-language-change", () => apply(preferred), listen);
    apply(preferred);
    cleanup = () => { controller.abort(); unsubscribe(); cancel(); controls.hidden = true; };
  }
  function dispose(): void { disposed = true; cleanup?.(); cleanup = undefined; }
  return { bind, dispose };
}
