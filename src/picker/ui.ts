import { errorText } from "../shared/errors";
import accentStyles from "../styles/accent-vars.css?raw";
import type { FolderPickerOptions, PickerFolder, PickerPage } from "./types";

// 收藏库（全屏页）和网页浮层（content script）共用的「选项目」面板。
//
// openFolderPicker(options) 两种用法共用同一套外观与交互：
//   • 整屏弹窗（收藏网页时选「收藏到哪个项目」）：不传 anchor，背后有灰色遮罩、面板居中。
//   • 贴着按钮的浮层（单篇或批量移动）：传 anchor = 触发它的项目控件，
//     没有遮罩、面板定位在按钮旁边，点外面或按 Esc 关闭。
//
// 之所以抽成共享模块：用户希望卡片上点出来的「窗口」和网页里收藏时那个是同一个，
// 只是出现的位置从「屏幕中央」变成了「按钮旁边」。两种用法走的就是同一份代码。
//
// 约定：chrome.* 不在顶层调用；扩展页与按需注入入口显式导入同一份模块。

// 新建项目：默认走后台的 CREATE_PROJECT（content script 和扩展页都通用）；
// 调用方也可以自己传 onCreateProject 覆盖（比如扩展页想顺带刷新本地列表）。
async function defaultCreateProject(name: string): Promise<{ readonly id: string; readonly name?: string } | null> {
  let response: { readonly project?: { readonly id: string; readonly name?: string } } | null = null;
  try { response = await chrome.runtime.sendMessage({ type: "CREATE_PROJECT", name }); }
  catch { /* 扩展更新后旧网页里的浮层可能还在；上下文失效时安静失败 */ }
  return response?.project || null;
}

function safeRuntimeUrl(path: string): string {
  try { return chrome.runtime.getURL(path); }
  catch { return ""; }
}

declare global {
  interface Window {
    __laterOnActivePickerClose?: () => void;
    LaterOnPickerKeyboard?: {
      capture: (handler: (event: Event) => void, active: () => boolean) => () => void;
    };
  }
}

/** @param {import("./types").FolderPickerOptions} options
 * @returns {{ readonly close: () => void }} */
export function openFolderPicker(options: FolderPickerOptions): { readonly close: () => void } {
  const data = options || {};
  const isPopover = !!data.anchor;
  const language = data.language === "en" || (!data.language && document.documentElement.lang === "en") ? "en" : "zh-CN";
  const copy = language === "en" ? {
    projects: "Choose a project", cancel: "Cancel", moveTitle: "Move this save to which project?",
    saveTitle: "Add to which project?", saveSingleTitle: "Add this page to which project?",
    singleSaved: "This page is already added — confirming will move it to the selected project", singleNew: "Choose a project to add this page",
    batchSaved: (total: number, saved: number) => `${total} tabs, including ${saved} already added — confirming will move them to the selected project`,
    batchNew: (total: number) => `${total} tabs — choose a project to start adding them one by one`, pages: (n: number) => `View the ${n} pages to be added`,
    inbox: "Inbox",
    processing: "Working…", createMove: (name: string) => `Create “${name}” and move`, createSave: (name: string) => `Create “${name}” and add`,
    moveTo: (name: string) => `Move to “${name}”`, saveTo: (name: string) => `Add to “${name}”`, createFailed: "Couldn’t create the project. Try again.",
    failed: "Something went wrong. Try again.", search: "Filter or name a new project…", noMatch: "No matching projects. Confirm to create this project.", nameTooLong: "New project names can contain up to 28 characters."
  } : {
    projects: "选择项目", cancel: "取消", moveTitle: "把这篇放到哪个项目？",
    saveTitle: "添加到哪个项目？", saveSingleTitle: "把这个网页添加到哪个项目？",
    singleSaved: "这个网页已经添加过——确认后会一并移进你选的项目", singleNew: "选好项目后就会添加这个网页",
    batchSaved: (total: number, saved: number) => `共 ${total} 个标签页，其中 ${saved} 个已经添加过——确认后会一并移进你选的项目`,
    batchNew: (total: number) => `共 ${total} 个标签页，选好项目后就会开始逐个添加`, pages: (n: number) => `查看将要添加的 ${n} 个网页`,
    inbox: "等待整理",
    processing: "正在处理…", createMove: (name: string) => `新建「${name}」并移入`, createSave: (name: string) => `新建「${name}」并添加`,
    moveTo: (name: string) => `移动到「${name}」`, saveTo: (name: string) => `添加到「${name}」`, createFailed: "新建项目失败，请重试。",
    failed: "操作失败，请重试。", search: "筛选项目，或输入新项目名…", noMatch: "没有匹配的项目，确认后将新建这个项目。", nameTooLong: "新项目名称最多 28 个字，请缩短后再确认。"
  };
  const contextCopy = language === "en" ? {
    allSaved: (n: number, name: string) => n === 1 ? `This page is already in “${name}”` : `All ${n} pages are already in “${name}”`,
    pages: (n: number, total: number) => n > total
      ? `View ${n} ${n === 1 ? "tab" : "tabs"} (${total} unique ${total === 1 ? "page" : "pages"})`
      : `View ${n} ${n === 1 ? "page and its current project" : "pages and their current projects"}`,
    mixed: (n: number, saved: number) => `${n} to add · ${saved} already saved`,
    group: (name: string, n: number) => `“${name}” · ${n}`, more: (n: number) => `${n} more ${n === 1 ? "project" : "projects"}`,
    allHere: "All already here", here: (n: number) => `${n} already here`,
    pending: "To add", savedIn: (name: string) => `Already in “${name}”`,
    keepTo: (name: string) => `Keep in “${name}”`, moveTo: (name: string) => `Move to “${name}”`,
    addMove: (n: number, moved: number) => `Add ${n} and move ${moved} pages`,
    preview: (n: number, kept: number, moved: number) => `Add ${n} · Keep ${kept} · Move ${moved}`,
    target: (name: string) => `To “${name}”`, newTarget: (name: string) => `New project “${name}”`,
    projectTotal: (n: number) => `${n} pages in this project`
  } : {
    allSaved: (n: number, name: string) => `这${n}篇都已在「${name}」`,
    pages: (n: number, total: number) => n > total ? `查看 ${n} 个标签页（共 ${total} 个网页）` : `查看 ${n} 个网页及当前归属`,
    mixed: (n: number, saved: number) => `${n}篇待添加 · ${saved}篇已存`,
    group: (name: string, n: number) => `「${name}」· ${n}篇`, more: (n: number) => `另${n}个项目`,
    allHere: "全部已在这里", here: (n: number) => `已在这里 ${n}篇`,
    pending: "待添加", savedIn: (name: string) => `已在「${name}」`,
    keepTo: (name: string) => `保留在「${name}」`, moveTo: (name: string) => `移入「${name}」`,
    addMove: (n: number, moved: number) => `添加${n}篇并移入${moved}篇`,
    preview: (n: number, kept: number, moved: number) => `新增${n} · 保留${kept} · 移入${moved}`,
    target: (name: string) => `到「${name}」`, newTarget: (name: string) => `新项目「${name}」`,
    projectTotal: (n: number) => `项目共${n}篇`
  };

  try { window.__laterOnActivePickerClose?.(); } catch { /* 旧实例收尾失败也不挡新开 */ }
  const HOST_ID = "lateron-folder-picker";
  const stale = document.getElementById(HOST_ID);
  if (stale) {
    stale.dispatchEvent(new Event("lateron-picker-dispose"));
    stale.remove();
  }
  const previousFocus = document.activeElement as HTMLElement | null;

  // 主题：跟着设置走；设置为「跟随系统」时看系统偏好。
  const themeSetting = data.theme || "light";
  const prefersDark = !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const dark = themeSetting === "dark" || (themeSetting !== "light" && prefersDark);

  let folders: PickerFolder[] = Array.isArray(data.folders) ? [...data.folders] : [];
  const pages: PickerPage[] = Array.isArray(data.pages) ? [...data.pages] : [];
  const savedCount = Number(data.savedCount) || 0;
  const saveContext = !isPopover && data.saveContext && typeof data.saveContext === "object" ? data.saveContext : null;
  const contextSaved = saveContext ? Math.max(0, Number(saveContext.savedCount) || 0) : 0;
  const contextNew = saveContext ? Math.max(0, Number(saveContext.newCount) || 0) : 0;
  const contextTotal = saveContext ? Math.max(0, Number(saveContext.total) || 0) : 0;
  const hasSavedContext = !!saveContext && contextSaved > 0;
  const contextGroups = saveContext && Array.isArray(saveContext.groups) ? saveContext.groups : [];
  let selected = typeof data.selected === "string" ? data.selected : "";
  let busy = false;
  let closed = false;
  let releaseKeyboard: (() => void) | null = null;

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.setProperty("all", "initial", "important");

  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = buildStyle();
  shadow.appendChild(style);

  const brandIcon = safeRuntimeUrl("icon128.png");
  const brandHtml = isPopover
    ? ""
    : `<div class="lon-brand">${brandIcon ? `<img class="lon-logo" src="${brandIcon}" width="34" height="34" alt="" />` : ""}StaySide</div>`;

  const root = document.createElement("div");
  root.className = "lon-root" + (isPopover ? " lon-popover" : "");
  if (dark) root.setAttribute("data-dark", "1");
  root.innerHTML = `
    <div class="lon-backdrop"></div>
    <div class="lon-panel" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="lateron-picker-title">
      <header>
        ${brandHtml}
        <h2 class="lon-title" id="lateron-picker-title"></h2>
        <p class="lon-summary"></p>
        <div class="lon-existing" hidden></div>
      </header>
      <details class="lon-pages">
        <summary><span class="lon-chev">▸</span><span class="lon-pages-label"></span></summary>
        <ul class="lon-page-list"></ul>
      </details>
      <div class="lon-box">
        <input class="lon-search-input lon-new-input" type="search" placeholder="${copy.search}" aria-label="${copy.search}" aria-describedby="lateron-project-status" autocomplete="off" />
        <div class="lon-folders" role="radiogroup" aria-label="${copy.projects}">
          <div class="lon-folder-list"></div>
          <p class="lon-empty" id="lateron-project-status" role="status" hidden>${copy.noMatch}</p>
        </div>
      </div>
      <p class="lon-action-preview" hidden></p>
      <footer class="lon-foot">
        <button type="button" class="lon-ghost">${copy.cancel}</button>
        <button type="button" class="lon-primary"></button>
      </footer>
    </div>
  `;
  shadow.appendChild(root);
  document.documentElement.appendChild(host);

  const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => root.querySelector<T>(selector)!;
  const panel = $(".lon-panel");
  const summaryEl = $(".lon-summary");
  const existingEl = $(".lon-existing");
  const previewEl = $(".lon-action-preview");
  const pagesLabel = $(".lon-pages-label");
  const pageList = $(".lon-page-list");
  const folderList = $(".lon-folder-list");
  const searchInput = $<HTMLInputElement>(".lon-search-input");
  const confirmBtn = $<HTMLButtonElement>(".lon-primary");
  const cancelBtn = $<HTMLButtonElement>(".lon-ghost");
  const emptyEl = $(".lon-empty");

  if (isPopover) {
    $(".lon-title").textContent = data.titleText || copy.moveTitle;
    summaryEl.textContent = "";
    $(".lon-pages").hidden = true;
  } else {
    const single = pages.length <= 1;
    $(".lon-title").textContent = copy.saveTitle;
    if (single) {
      $(".lon-title").textContent = copy.saveSingleTitle;
      summaryEl.textContent = savedCount > 0 ? copy.singleSaved : copy.singleNew;
      $(".lon-pages").hidden = true;
    } else {
      summaryEl.textContent = savedCount > 0 ? copy.batchSaved(pages.length, savedCount) : copy.batchNew(pages.length);
    }
  }
  if (hasSavedContext) {
    const sameGroup = contextGroups.find((group) => group.projectId === saveContext!.sameProjectId);
    summaryEl.textContent = contextNew === 0 && typeof saveContext!.sameProjectId === "string"
      ? contextCopy.allSaved(contextTotal, sameGroup?.projectName || folders.find((folder) => folder.id === saveContext!.sameProjectId)?.name || copy.inbox)
      : contextCopy.mixed(contextNew, contextSaved);
    summaryEl.setAttribute("role", "status");
    summaryEl.setAttribute("aria-live", "polite");
    summaryEl.setAttribute("aria-atomic", "true");
    if (contextGroups.length && !(contextNew === 0 && typeof saveContext!.sameProjectId === "string")) {
      existingEl.hidden = false;
      contextGroups.slice(0, 3).forEach((group) => {
        const chip = document.createElement("span");
        chip.className = "lon-existing-group";
        chip.textContent = contextCopy.group(group.projectName || copy.inbox, group.count);
        chip.title = chip.textContent;
        existingEl.append(chip);
      });
      if (contextGroups.length > 3) {
        const more = document.createElement("span");
        more.className = "lon-existing-more";
        more.textContent = contextCopy.more(contextGroups.length - 3);
        existingEl.append(more);
      }
    }
    previewEl.hidden = false;
    previewEl.setAttribute("role", "status");
    previewEl.setAttribute("aria-live", "polite");
    previewEl.setAttribute("aria-atomic", "true");
    $(".lon-pages").hidden = false;
  }
  pagesLabel.textContent = hasSavedContext ? contextCopy.pages(pages.length, contextTotal) : copy.pages(pages.length);
  pages.forEach((page, index) => {
    const li = document.createElement("li");
    const no = document.createElement("span");
    no.className = "lon-page-no";
    no.textContent = String(index + 1);
    const title = document.createElement("span");
    title.className = "lon-page-title";
    title.textContent = page.title || page.url;
    title.title = page.url || "";
    if (saveContext) {
      const info = document.createElement("span");
      info.className = "lon-page-info";
      const url = document.createElement("span");
      url.className = "lon-page-url";
      url.textContent = page.url || "";
      const status = document.createElement("span");
      status.className = "lon-page-status";
      status.textContent = page.saved ? contextCopy.savedIn(page.projectName || copy.inbox) : contextCopy.pending;
      info.append(title, url, status);
      li.append(no, info);
    } else {
      li.append(no, title);
    }
    pageList.append(li);
  });

  const queryName = () => searchInput.value.replace(/\s+/g, " ").trim();
  const visibleFolders = () => {
    const query = queryName().toLocaleLowerCase();
    if (!query) return folders;
    return folders.filter((folder) => String(folder.name || "").replace(/\s+/g, " ").trim().toLocaleLowerCase().includes(query));
  };
  const pendingNewName = () => (visibleFolders().length ? "" : queryName());
  const selectedName = () => {
    if (!selected) return copy.inbox;
    return folders.find((folder) => folder.id === selected)?.name || copy.inbox;
  };
  const actionCounts = () => {
    const name = pendingNewName();
    const folder = name ? null : folders.find((item) => item.id === selected);
    const kept = Math.min(contextSaved, Math.max(0, Number(folder?.matchedCount) || 0));
    return { added: contextNew, kept, moved: contextSaved - kept };
  };
  const applyLabel = () => {
    const name = pendingNewName();
    confirmBtn.disabled = busy || name.length > 28;
    searchInput.readOnly = busy;
    searchInput.setAttribute("aria-invalid", String(name.length > 28));
    if (name) {
      confirmBtn.textContent = busy
        ? copy.processing
        : (isPopover || (hasSavedContext && contextNew === 0) ? copy.createMove(name) : copy.createSave(name));
    } else {
      const { added, moved } = actionCounts();
      confirmBtn.textContent = busy
        ? copy.processing
        : (hasSavedContext
          ? (added > 0 ? (moved > 0 ? contextCopy.addMove(added, moved) : copy.saveTo(selectedName()))
            : (moved > 0 ? contextCopy.moveTo(selectedName()) : contextCopy.keepTo(selectedName())))
          : (isPopover ? copy.moveTo(selectedName()) : copy.saveTo(selectedName())));
    }
    if (hasSavedContext) {
      const { added, kept, moved } = actionCounts();
      previewEl.textContent = `${name ? contextCopy.newTarget(name) : contextCopy.target(selectedName())} · ${contextCopy.preview(added, kept, moved)}`;
    }
  };

  function makePlaceholder(name: string | undefined) {
    const span = document.createElement("span");
    span.className = "lon-folder-ph";
    span.textContent = (name || "·").trim().slice(0, 1);
    return span;
  }

  function isSafeCoverSource(value: string | undefined): value is string {
    const source = String(value || "").trim();
    if (!source) return false;
    try {
      const parsed = new URL(source, document.baseURI);
      if (["https:", "data:", "blob:", "chrome-extension:", "moz-extension:"].includes(parsed.protocol)) {
        return true;
      }
      return parsed.protocol === "http:" && window.location.protocol !== "https:";
    } catch {
      return false;
    }
  }

  const renderFolders = () => {
    folderList.replaceChildren();
    const visible = visibleFolders();
    emptyEl.hidden = visible.length > 0;
    emptyEl.textContent = pendingNewName().length > 28 ? copy.nameTooLong : copy.noMatch;
    visible.forEach((folder) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `lon-folder${selected === folder.id ? " is-selected" : ""}`;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", selected === folder.id ? "true" : "false");

      const icon = document.createElement("span");
      icon.className = "lon-folder-icon";
      if (isSafeCoverSource(folder.cover)) {
        const img = document.createElement("img");
        img.className = "lon-folder-thumb";
        img.src = folder.cover;
        img.alt = "";
        img.loading = "lazy";
        img.addEventListener("error", () => icon.replaceChildren(makePlaceholder(folder.name)));
        icon.append(img);
      } else {
        icon.append(makePlaceholder(folder.name));
      }
      const name = document.createElement("span");
      name.className = "lon-folder-name";
      name.textContent = folder.name ?? "";
      const count = document.createElement("strong");
      count.className = "lon-folder-count";
      count.textContent = String(folder.count || 0);
      if (hasSavedContext) count.title = contextCopy.projectTotal(folder.count || 0);
      const tick = document.createElement("span");
      tick.className = "lon-folder-tick";
      tick.textContent = "✓";
      if (hasSavedContext && Number(folder.matchedCount) > 0) {
        const label = document.createElement("span");
        label.className = "lon-folder-matched";
        const matched = Number(folder.matchedCount) || 0;
        label.textContent = matched === contextTotal && contextNew === 0
          ? contextCopy.allHere : contextCopy.here(matched);
        const info = document.createElement("span");
        info.className = "lon-folder-info";
        info.append(name, label);
        button.append(icon, info, count, tick);
      } else {
        button.append(icon, name, count, tick);
      }

      button.addEventListener("click", () => {
        if (busy) return;
        selected = folder.id;
        renderFolders();
      });
      button.addEventListener("dblclick", () => {
        if (busy) return;
        selected = folder.id;
        renderFolders();
        submitSelection();
      });
      folderList.append(button);
    });
    applyLabel();
  };

  let keepPlaying = new WeakSet<HTMLMediaElement>();
  const rememberPlaying = () => {
    document.querySelectorAll<HTMLMediaElement>("video, audio").forEach((media) => {
      if (!media.paused && !media.ended) keepPlaying.add(media);
    });
  };
  const onMediaPause = (event: Event) => {
    const media = event.target;
    if (closed || !(media instanceof HTMLMediaElement) || !keepPlaying.has(media)) return;
    if (media.ended) { keepPlaying.delete(media); return; }
    try {
      const playing = media.play?.();
      if (playing && typeof playing.catch === "function") playing.catch(() => {});
    } catch { /* 播不回去就算了 */ }
  };
  const onMediaEnded = (event: Event) => { if (event.target instanceof HTMLMediaElement) keepPlaying.delete(event.target); };
  rememberPlaying();
  window.addEventListener("pause", onMediaPause, true);
  window.addEventListener("ended", onMediaEnded, true);

  const positionPanel = () => {
    if (!isPopover || !data.anchor) return;
    const rect = data.anchor.getBoundingClientRect();
    const pw = panel.offsetWidth || 360;
    const ph = panel.offsetHeight || 360;
    let top = rect.bottom + 8;
    if (top + ph > window.innerHeight - 8) top = rect.top - ph - 8;
    if (top < 8) top = 8;
    let left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - pw - 8));
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
  };

  const close = () => {
    if (closed) return;
    closed = true;
    const ownedFocus = document.activeElement === host;
    host.inert = true;
    if (ownedFocus && previousFocus?.isConnected) previousFocus.focus?.({ preventScroll: true });
    releaseKeyboard?.();
    if (window.__laterOnActivePickerClose === close) delete window.__laterOnActivePickerClose;
    for (const type of ["keydown", "keypress", "keyup"]) window.removeEventListener(type, onModalKeyboard, true);
    window.removeEventListener("keydown", onPopoverKeydown, true);
    window.removeEventListener("scroll", positionPanel, true);
    window.removeEventListener("resize", positionPanel);
    window.removeEventListener("pause", onMediaPause, true);
    window.removeEventListener("ended", onMediaEnded, true);
    keepPlaying = new WeakSet<HTMLMediaElement>();
    root.classList.remove("is-in");
    root.classList.add("is-out");
    window.setTimeout(() => host.remove(), 260);
  };

  host.addEventListener("lateron-picker-dispose", close, { once: true });

  const resolveProjectId = async () => {
    const name = pendingNewName();
    if (!name) return { ok: true as const, projectId: selected || null };
    const create = data.onCreateProject || defaultCreateProject;
    let project = null;
    try { project = await create(name); } catch { /* 调用方失效时留在浮层里显示失败 */ }
    if (!project || !project.id) return { ok: false as const, error: copy.createFailed };
    if (!folders.some((folder) => folder.id === project.id)) {
      folders = [...folders, { id: project.id, name: project.name, count: 0, matchedCount: 0 }];
    }
    selected = project.id;
    const created = folders.find((folder) => folder.id === selected);
    if (created?.name) searchInput.value = created.name;
    renderFolders();
    return { ok: true as const, projectId: project.id };
  };

  const submitSelection = async () => {
    if (busy || closed || confirmBtn.disabled) return;
    busy = true;
    confirmBtn.disabled = true;
    applyLabel();
    const target = await resolveProjectId();
    if (!target.ok) {
      busy = false;
      confirmBtn.disabled = false;
      applyLabel();
      summaryEl.textContent = target.error ?? "";
      return;
    }
    let result;
    try {
      result = data.onPick ? await data.onPick(target.projectId ?? null, selectedName()) : null;
    } catch (error) {
      result = { ok: false as const, error: errorText(error) || copy.failed };
    }
    if (result && result.ok === false) {
      busy = false;
      confirmBtn.disabled = false;
      applyLabel();
      if (result.error) summaryEl.textContent = result.error;
      return;
    }
    close();
  };

  const cancel = async () => {
    if (busy || closed) return;
    busy = true;
    if (data.onCancel) { try { await data.onCancel(); } catch { /* 取消失败也不拦着关掉 */ } }
    close();
  };

  const typingInInput = (event: Event) => event.composedPath().includes(searchInput);

  function onKeydown(event: KeyboardEvent) {
    if (closed) return;
    event.stopImmediatePropagation();
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const targets = [...root.querySelectorAll<HTMLElement>("input, button, summary")]
        .filter((el) => !("disabled" in el && (el as HTMLButtonElement).disabled) && !el.closest("[hidden]"));
      const index = targets.indexOf(shadow.activeElement as HTMLElement);
      const next = (index + (event.shiftKey ? -1 : 1) + targets.length) % targets.length;
      targets[next]?.focus();
      return;
    }
    if (typingInInput(event)) {
      if (event.key === "Enter") { event.preventDefault(); submitSelection(); }
      if (event.key === "ArrowDown" && event.composedPath().includes(searchInput)) {
        event.preventDefault();
        folderList.querySelector<HTMLButtonElement>("button")?.focus();
      }
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const control = event.composedPath().some((node) => node instanceof HTMLElement && (node.tagName === "BUTTON" || node.tagName === "SUMMARY"));
    if (control && (event.key === "Enter" || event.key === " ")) return;
    if (event.key === "Enter") {
      event.preventDefault();
      submitSelection();
      return;
    }
    event.preventDefault();
  }

  function onModalKeyboard(event: Event) {
    if (!host.isConnected) { close(); return; }
    if (event.type === "keydown") onKeydown(event as KeyboardEvent);
    else if (!closed) event.stopImmediatePropagation();
  }

  function onPopoverKeydown(event: KeyboardEvent) {
    if (closed) return;
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  }

  const swallowTyping = (event: Event) => event.stopPropagation();
  searchInput.addEventListener("input", () => {
    if (busy) return;
    const visible = visibleFolders();
    if (visible.length && !visible.some((folder) => folder.id === selected)) selected = visible[0]!.id;
    renderFolders();
    if (isPopover) positionPanel();
  });
  searchInput.addEventListener("keyup", swallowTyping);
  searchInput.addEventListener("keypress", swallowTyping);
  searchInput.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") { event.preventDefault(); submitSelection(); }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      folderList.querySelector<HTMLButtonElement>("button")?.focus();
    }
  });

  confirmBtn.addEventListener("click", submitSelection);
  cancelBtn.addEventListener("click", cancel);
  $(".lon-backdrop").addEventListener("click", cancel);

  if (isPopover) {
    window.addEventListener("keydown", onPopoverKeydown, true);
    window.addEventListener("scroll", positionPanel, true);
    window.addEventListener("resize", positionPanel);
  } else {
    if (window.LaterOnPickerKeyboard) {
      releaseKeyboard = window.LaterOnPickerKeyboard.capture(onModalKeyboard, () => !closed && host.isConnected);
    } else {
      for (const type of ["keydown", "keypress", "keyup"]) window.addEventListener(type, onModalKeyboard, true);
    }
  }

  window.__laterOnActivePickerClose = close;
  renderFolders();
  if (isPopover) positionPanel();
  searchInput.focus({ preventScroll: true });
  window.requestAnimationFrame(() => {
    if (closed || !host.isConnected) return;
    root.classList.add("is-in");
    if (!hasSavedContext || contextNew !== 0 || typeof saveContext?.sameProjectId !== "string" || selected !== saveContext.sameProjectId) return;
    const row = folderList.querySelector('[role="radio"][aria-checked="true"]');
    if (!row) return;
    const box = $(".lon-folders");
    const bounds = box.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();
    const scale = box.offsetHeight > 0 && bounds.height > 0 ? bounds.height / box.offsetHeight : 1;
    if (rowBounds.top < bounds.top) box.scrollTop += (rowBounds.top - bounds.top) / scale;
    else if (rowBounds.bottom > bounds.bottom) box.scrollTop += (rowBounds.bottom - bounds.bottom) / scale;
  });

  return { close };
}

function buildStyle() {
  return `
    ${accentStyles}
    :host { all: initial; }
    .lon-root, .lon-root *, .lon-root *::before, .lon-root *::after { box-sizing: border-box; }
    .lon-root {
      position: fixed; inset: 0; z-index: 2147483600;
      display: flex; align-items: center; justify-content: center;
      padding: 24px; overflow: auto;
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      font-size: 14px; font-weight: 400; line-height: 1.5;
      letter-spacing: normal; word-spacing: normal; text-align: left;
      text-transform: none; text-indent: 0; white-space: normal; direction: ltr;
      color: var(--lon-ink); -webkit-font-smoothing: antialiased;
      --lon-card: #fdfcfa;
      --lon-ink: #171614;
      --lon-muted: #8a857c;
      --lon-subtle: #aaa69d;
      --lon-line: #e8e5dd;
      --lon-field: #ffffff;
      --lon-soft: #f1f0eb;
      --lon-soft-hover: #e7e5df;
      --lon-accent: var(--accent);
      --lon-accent-soft: var(--accent-soft);
      --lon-panel-shadow: 0 34px 80px -24px rgba(15,13,10,.5), 0 8px 26px -10px rgba(15,13,10,.2);
      --lon-btn-shadow: 0 8px 20px -8px rgba(var(--accent-rgb),.35);
    }
    .lon-root[data-dark="1"] {
      --lon-card: #211f1d;
      --lon-ink: #f3f1ec;
      --lon-muted: #9a958c;
      --lon-subtle: #857f76;
      --lon-line: rgba(255,255,255,.1);
      --lon-field: #2a2725;
      --lon-soft: #2f2c29;
      --lon-soft-hover: #38342f;
      --lon-panel-shadow: 0 34px 80px -24px rgba(0,0,0,.82), 0 8px 26px -10px rgba(0,0,0,.55);
    }
    .lon-backdrop {
      position: absolute; inset: 0;
      background: rgba(20,18,14,.44);
      -webkit-backdrop-filter: blur(4px) saturate(130%);
      backdrop-filter: blur(4px) saturate(130%);
      opacity: 0; transition: opacity .22s ease;
    }
    .lon-panel {
      position: relative; display: flex; flex-direction: column; gap: 15px;
      width: min(432px, 100%); max-height: min(648px, calc(100vh - 48px));
      padding: 24px 24px 20px;
      border: 1px solid var(--lon-line); border-radius: 22px;
      background: var(--lon-card); box-shadow: var(--lon-panel-shadow);
      opacity: 0; transform: translateY(12px) scale(.97);
      transition: opacity .24s ease, transform .3s cubic-bezier(.2,.8,.3,1);
      outline: none;
    }
    .lon-root.is-in .lon-backdrop { opacity: 1; }
    .lon-root.is-in .lon-panel { opacity: 1; transform: none; }
    .lon-root.is-out .lon-backdrop { opacity: 0; }
    .lon-root.is-out .lon-panel { opacity: 0; transform: translateY(8px) scale(.98); }

    .lon-brand { display: flex; align-items: center; gap: 10px; color: var(--lon-muted); font-size: 13.5px; font-weight: 700; letter-spacing: .2px; }
    .lon-logo {
      display: block; width: 34px; height: 34px; border-radius: 9px;
      box-shadow: 0 6px 16px -6px rgba(var(--accent-rgb),.35);
    }
    .lon-title { margin: 12px 0 0; font-size: 20px; font-weight: 800; letter-spacing: -.4px; line-height: 1.3; color: var(--lon-ink); }
    .lon-summary { margin: 7px 0 0; color: var(--lon-muted); font-size: 12.5px; line-height: 1.6; overflow-wrap: anywhere; }
    .lon-existing { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; min-width: 0; }
    .lon-existing[hidden], .lon-action-preview[hidden] { display: none; }
    .lon-existing-group { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-radius: 5px; padding: 2px 6px; background: var(--lon-soft); color: var(--lon-muted); font-size: 11px; }
    .lon-existing-more { padding: 2px 0; color: var(--lon-muted); font-size: 11px; }
    .lon-action-preview { flex: none; margin: 0; color: var(--lon-muted); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }

    .lon-pages { border: 1px solid var(--lon-line); border-radius: 14px; background: var(--lon-soft); padding: 10px 13px; }
    .lon-pages[hidden] { display: none; }
    .lon-pages > summary { display: flex; align-items: center; gap: 7px; cursor: pointer; color: var(--lon-muted); font-size: 12.5px; font-weight: 650; list-style: none; }
    .lon-pages > summary::-webkit-details-marker { display: none; }
    .lon-chev { color: var(--lon-subtle); font-size: 10px; transition: transform .18s ease; }
    .lon-pages[open] .lon-chev { transform: rotate(90deg); }
    .lon-page-list { display: flex; flex-direction: column; gap: 5px; margin: 10px 0 2px; padding: 0 2px 0 0; list-style: none; max-height: 112px; overflow: auto; }
    .lon-page-list li { display: flex; align-items: baseline; gap: 8px; font-size: 12px; line-height: 1.5; }
    .lon-page-no { flex: none; min-width: 15px; color: var(--lon-subtle); font-size: 10.5px; font-weight: 700; text-align: right; }
    .lon-page-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--lon-ink); opacity: .82; }
    .lon-page-info { flex: 1; min-width: 0; }
    .lon-page-info .lon-page-title { display: block; }
    .lon-page-url { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10.5px; color: var(--lon-subtle); }
    .lon-page-status { display: block; overflow-wrap: anywhere; font-size: 11px; color: var(--lon-muted); }

    .lon-box { display: flex; flex-direction: column; gap: 9px; min-height: 0; }
    .lon-search-input, .lon-new-input {
      flex: none; width: 100%; border: 1px solid var(--lon-line); border-radius: 10px; padding: 10px 12px;
      background: var(--lon-field); color: var(--lon-ink); font-family: inherit; font-size: 13px; outline: none;
      transition: border-color .15s, box-shadow .15s;
    }
    .lon-search-input::placeholder, .lon-new-input::placeholder { color: var(--lon-subtle); }
    .lon-search-input:focus, .lon-new-input:focus { border-color: var(--lon-accent); box-shadow: 0 0 0 3px rgba(var(--accent-rgb),.14); }
    .lon-empty { margin: 8px 2px 0; color: var(--lon-muted); font-size: 12px; line-height: 1.5; }
    .lon-empty[hidden] { display: none; }
    .lon-folders { display: flex; flex-direction: column; gap: 6px; max-height: 230px; overflow: auto; padding: 2px; margin: -2px; }
    .lon-folder-list { display: flex; flex-direction: column; gap: 6px; }
    .lon-folder {
      display: flex; align-items: center; gap: 11px; width: 100%;
      border: 1px solid var(--lon-line); border-radius: 13px; padding: 11px 13px;
      background: var(--lon-field); color: var(--lon-ink);
      font-family: inherit; font-size: 13.5px; text-align: left; cursor: pointer;
      transition: background .15s, border-color .15s, box-shadow .15s, transform .12s;
    }
    .lon-folder:hover { background: var(--lon-soft); }
    .lon-folder:active { transform: scale(.992); }
    .lon-root :is(button, summary):focus-visible { outline: 2px solid var(--lon-accent); outline-offset: 2px; }
    .lon-folder.is-selected { border-color: var(--lon-accent); background: var(--lon-accent-soft); box-shadow: 0 0 0 3px rgba(var(--accent-rgb),.1); }
    .lon-folder-icon { display: block; flex: none; width: 30px; height: 30px; border-radius: 9px; overflow: hidden; background: transparent; }
    .lon-folder-thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
    .lon-folder-ph { width: 100%; height: 100%; display: grid; place-items: center; border-radius: 9px; background: var(--accent-soft-hover); color: var(--lon-accent); font-size: 13px; font-weight: 800; }
    .lon-folder-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13.5px; font-weight: 650; }
    .lon-folder-info { display: flex; flex-direction: column; flex: 1; min-width: 0; gap: 2px; }
    .lon-folder-matched { font-size: 10.5px; font-weight: 500; color: var(--lon-muted); }
    .lon-folder-count { flex: none; color: var(--lon-subtle); font-size: 11.5px; font-weight: 700; }
    .lon-folder.is-selected .lon-folder-count { color: var(--lon-accent); }
    .lon-folder-tick { flex: none; width: 14px; color: var(--lon-accent); font-size: 13px; font-weight: 800; opacity: 0; transition: opacity .15s; }
    .lon-folder.is-selected .lon-folder-tick { opacity: 1; }

    .lon-foot { display: flex; gap: 10px; }
    .lon-foot button {
      min-width: 0; overflow-wrap: anywhere; line-height: 1.5;
      border-radius: 14px; padding: 12px; font-family: inherit; font-size: 13.5px; cursor: pointer;
      transition: filter .15s, background .15s, transform .12s;
    }
    .lon-ghost { flex: 1; border: 1px solid var(--lon-line); background: transparent; color: var(--lon-ink); font-weight: 650; }
    .lon-ghost:hover { background: var(--lon-soft); }
    .lon-primary {
      flex: 1.7; border: 0; background: var(--accent-gradient);
      color: var(--accent-on); font-weight: 750; box-shadow: var(--lon-btn-shadow);
    }
    .lon-primary:hover:not(:disabled) { filter: brightness(1.05); }
    .lon-primary:active:not(:disabled) { transform: scale(.985); }
    .lon-primary:disabled { opacity: .62; cursor: default; box-shadow: none; }

    .lon-folders::-webkit-scrollbar, .lon-page-list::-webkit-scrollbar { width: 8px; }
    .lon-folders::-webkit-scrollbar-thumb, .lon-page-list::-webkit-scrollbar-thumb { border-radius: 99px; background: var(--lon-line); }
    .lon-folders::-webkit-scrollbar-track, .lon-page-list::-webkit-scrollbar-track { background: transparent; }

    .lon-root.lon-popover {
      display: block; padding: 0; pointer-events: none;
    }
    .lon-root.lon-popover .lon-backdrop {
      background: transparent; -webkit-backdrop-filter: none; backdrop-filter: none;
      opacity: 1; pointer-events: auto; transition: none;
    }
    .lon-root.lon-popover .lon-panel {
      position: absolute; pointer-events: auto;
      width: min(360px, calc(100vw - 16px));
      max-height: min(560px, calc(100vh - 16px));
    }
    .lon-root.lon-popover .lon-title { margin-top: 0; }

    @media (max-width: 460px) {
      .lon-root { padding: 12px; }
      .lon-panel { gap: 12px; padding: 18px 16px 14px; border-radius: 18px; }
      .lon-title { font-size: 18px; }
    }
  `;
}