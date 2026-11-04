import type { Theme } from "../settings/shared";

export type NoticeKind = "" | "success" | "skip" | "move" | "error";
export interface PageNotice {
  readonly text: string;
  readonly kind?: NoticeKind;
  readonly title?: string;
  readonly detail?: string;
}

// executeScript serializes this function; all browser-side helpers must stay inside it.
export function showPageNotices(items: readonly PageNotice[], extra: number, overflowText: string, theme: Theme, styles: string): void {
  const hostId = "lateron-pill-stack";
  const host = document.getElementById(hostId) || document.createElement("div");
  if (!host.isConnected) {
    host.id = hostId;
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    host.setAttribute("aria-atomic", "false");
    Object.entries({ all: "initial", position: "fixed", top: "18px", right: "18px", "z-index": "2147483647",
      display: "block", "max-width": "calc(100vw - 36px)", "pointer-events": "none" })
      .forEach(([property, value]) => host.style.setProperty(property, value, "important"));
    document.documentElement.appendChild(host);
  }
  const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
  const root = shadow.querySelector<HTMLElement>(".lon-root") || document.createElement("div");
  if (!root.isConnected) {
    const style = document.createElement("style");
    style.textContent = styles;
    root.className = "lon-root";
    shadow.replaceChildren(style, root);
  }
  root.dataset.dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "1" : "0";
  const all: readonly PageNotice[] = extra > 0 ? [...items, { text: overflowText }] : items;
  all.forEach((item, index) => {
    const notice = document.createElement("div");
    notice.className = `notice${item.kind ? ` is-${item.kind}` : ""}`;
    const mark = document.createElement("span");
    mark.className = "mark";
    mark.style.animationDelay = `${index * 90 + 60}ms`;
    mark.setAttribute("aria-hidden", "true");
    if (item.kind === "success") {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 20 20");
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.setAttribute("d", "m4.5 10 3.6 3.7L15.7 6");
      svg.appendChild(path);
      mark.appendChild(svg);
    } else {
      mark.textContent = item.kind === "skip" ? "↺" : item.kind === "move" ? "↪" : item.kind === "error" ? "!" : "i";
    }
    const copy = document.createElement("div");
    copy.className = "copy";
    const title = document.createElement("div");
    title.className = "headline";
    title.textContent = item.title || item.text;
    copy.appendChild(title);
    if (item.detail) {
      const detail = document.createElement("div");
      detail.className = "detail";
      detail.textContent = item.detail;
      copy.appendChild(detail);
    }
    notice.append(mark, copy);
    notice.style.animationDelay = `${index * 90}ms`;
    root.appendChild(notice);
    while (root.childElementCount > 6) root.firstElementChild?.remove();
    window.setTimeout(() => {
      if (!notice.isConnected) return;
      notice.classList.add("is-out");
      window.setTimeout(() => {
        notice.remove();
        if (!root.childElementCount) host.remove();
      }, 140);
    }, 3180 + index * 90);
  });
}
