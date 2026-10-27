import { t, ready } from "../shared/i18n-runtime.js";

const SEEN_KEY = "laterOnOnboardingSeen";

let disposeCurrent = () => {};

function shouldForceOpen() {
  try { return new URLSearchParams(window.location.search).get("guide") === "1"; }
  catch { return false; }
}

export async function markSeen() {
  try { await chrome.storage.local.set({ [SEEN_KEY]: true }); } catch {}
}

export function openOnboarding() {
  disposeCurrent();
  let step = 0;
  let closing = false;
  let alive = true;
  const previousFocus = document.activeElement;
  const events = new AbortController();
  const timers = new Set();
  const frames = new Set();
  const later = (callback, delay) => {
    const id = window.setTimeout(() => { timers.delete(id); if (alive) callback(); }, delay);
    timers.add(id);
  };
  const frame = callback => {
    const id = window.requestAnimationFrame(() => { frames.delete(id); if (alive) callback(); });
    frames.add(id);
  };
  const steps = [
    { icon: "+", title: "guideStepSaveTitle", body: "guideStepSaveBody", hint: "guideStepSaveHint" },
    { icon: "◎", title: "guideStepInboxTitle", body: "guideStepInboxBody", hint: "guideStepInboxHint" },
    { icon: "⛶", title: "guideStepReadTitle", body: "guideStepReadBody", hint: "guideStepReadHint" }
  ];

  const root = document.createElement("div");
  root.className = "lon-guide";
  root.innerHTML = `
    <div class="lon-guide-backdrop"></div>
    <section class="lon-guide-card" role="dialog" aria-modal="true" aria-labelledby="lon-guide-title" tabindex="-1">
      <div class="lon-guide-brand"><img src="icon128.png" alt="" />LaterOn</div>
      <div class="lon-guide-progress" aria-hidden="true"></div>
      <div class="lon-guide-page">
        <div class="lon-guide-icon" aria-hidden="true"></div>
        <h2 id="lon-guide-title"></h2>
        <p class="lon-guide-body"></p>
        <p class="lon-guide-hint"></p>
      </div>
      <footer>
        <button type="button" class="lon-guide-skip"></button>
        <button type="button" class="lon-guide-next"></button>
      </footer>
    </section>`;
  document.body.append(root);

  const dispose = () => {
    if (!alive) return;
    alive = false;
    timers.forEach(id => window.clearTimeout(id));
    frames.forEach(id => window.cancelAnimationFrame(id));
    events.abort();
    const restore = root.contains(document.activeElement);
    root.remove();
    if (restore && previousFocus?.isConnected) previousFocus.focus?.({ preventScroll: true });
  };
  disposeCurrent = dispose;
  const card = root.querySelector(".lon-guide-card");
  const page = root.querySelector(".lon-guide-page");
  let transitioning = false;
  const render = () => {
    const current = steps[step];
    root.querySelector(".lon-guide-icon").textContent = current.icon;
    root.querySelector("h2").textContent = t(current.title);
    root.querySelector(".lon-guide-body").textContent = t(current.body);
    root.querySelector(".lon-guide-hint").textContent = t(current.hint);
    root.querySelector(".lon-guide-skip").textContent = t("guideSkip");
    root.querySelector(".lon-guide-next").textContent = step === steps.length - 1 ? t("guideFinish") : t("guideNext");
    root.querySelector(".lon-guide-progress").replaceChildren(...steps.map((_, index) => {
      const dot = document.createElement("span");
      dot.className = index === step ? "active" : "";
      return dot;
    }));
  };
  const close = () => {
    if (closing) return;
    closing = true;
    timers.forEach(id => window.clearTimeout(id));
    frames.forEach(id => window.cancelAnimationFrame(id));
    timers.clear(); frames.clear();
    void markSeen();
    root.classList.add("is-leaving");
    later(dispose, 180);
  };
  root.querySelector(".lon-guide-skip").addEventListener("click", close, { signal: events.signal });
  root.querySelector(".lon-guide-next").addEventListener("click", () => {
    if (transitioning || closing) return;
    if (step >= steps.length - 1) { close(); return; }
    transitioning = true;
    page.classList.add("is-leaving");
    later(() => {
      step += 1;
      render();
      page.classList.remove("is-leaving");
      page.classList.add("is-entering");
      frame(() => frame(() => {
        page.classList.remove("is-entering");
        transitioning = false;
      }));
    }, 150);
  }, { signal: events.signal });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
    if (event.key === "Enter") { event.preventDefault(); root.querySelector(".lon-guide-next").click(); }
  }, { signal: events.signal });
  window.addEventListener("lateron-language-change", render, { signal: events.signal });
  render();
  frame(() => root.classList.add("is-visible"));
  card.focus({ preventScroll: true });
  return dispose;
}

// Entry-owned lifecycle: disposing during preferences/seen reads cannot open a late guide.
export function initOnboarding() {
  let alive = true;
  let timer;
  let disposeGuide;
  const start = async () => {
    await ready;
    if (!alive) return;
    let seen = false;
    try { seen = !!(await chrome.storage.local.get(SEEN_KEY))[SEEN_KEY]; } catch {}
    if (!alive || (seen && !shouldForceOpen())) return;
    timer = window.setTimeout(() => { if (alive) disposeGuide = openOnboarding(); }, 220);
  };
  void start();
  return () => { alive = false; window.clearTimeout(timer); disposeGuide?.(); };
}
