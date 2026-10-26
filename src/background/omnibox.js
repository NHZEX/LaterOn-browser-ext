import { isWebUrl, usesEnglish, STORAGE_KEY, PROJECTS_KEY, CURRENT_ITEM_KEY } from "./shared.js";
import { normalize as normalizeUrl } from "../shared/url-utils";

// ── 地址栏搜索：输入 `lo` + 空格后直接查 LaterOn ─────────────
function escapeOmniboxText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function omniboxMatches(items, projects, text) {
  const words = String(text || "").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const projectNames = new Map((projects || []).map((project) => [project.id, project.name]));
  return (items || [])
    .filter((item) => isWebUrl(item.url) && !(projects || []).some((project) => project.id === item.projectId && project.archived))
    .map((item) => {
      const title = String(item.title || item.url || "");
      const project = projectNames.get(item.projectId) || "";
      const haystack = `${title} ${item.description || ""} ${item.source || ""} ${item.url || ""} ${project}`.toLocaleLowerCase();
      if (words.some((word) => !haystack.includes(word))) return null;
      const loweredTitle = title.toLocaleLowerCase();
      const phrase = words.join(" ");
      const score = !words.length ? 0
        : loweredTitle.startsWith(phrase) ? 4
          : loweredTitle.includes(phrase) ? 3
            : words.every((word) => loweredTitle.includes(word)) ? 2 : 1;
      return { item, project, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || Number(b.item.savedAt || 0) - Number(a.item.savedAt || 0))
    .slice(0, 5);
}

async function setOmniboxDefault(text = "") {
  if (!chrome.omnibox?.setDefaultSuggestion) return;
  const en = await usesEnglish();
  const value = escapeOmniboxText(String(text || "").trim());
  const description = value
    ? (en ? `Search LaterOn for <match>${value}</match>` : `在 LaterOn 中搜索 <match>${value}</match>`)
    : (en ? "Search your LaterOn pages" : "搜索 LaterOn 网页");
  await chrome.omnibox.setDefaultSuggestion({ description }).catch(() => {});
}

let omniboxGeneration = 0;

async function openFromOmnibox(url, disposition) {
  if (disposition === "newForegroundTab" || disposition === "newBackgroundTab") {
    await chrome.tabs.create({ url, active: disposition === "newForegroundTab" });
    return;
  }
  try { await chrome.tabs.update({ url }); }
  catch { await chrome.tabs.create({ url }); }
}

export function registerOmnibox() {
  chrome.omnibox?.onInputStarted?.addListener(() => { setOmniboxDefault().catch(() => {}); });

  chrome.omnibox?.onInputChanged?.addListener((text, suggest) => {
    const generation = ++omniboxGeneration;
    Promise.all([
      chrome.storage.local.get([STORAGE_KEY, PROJECTS_KEY]),
      usesEnglish(),
      setOmniboxDefault(text)
    ]).then(([stored, en]) => {
      if (generation !== omniboxGeneration) return;
      const inbox = en ? "Inbox" : "等待整理";
      const suggestions = omniboxMatches(stored[STORAGE_KEY] || [], stored[PROJECTS_KEY] || [], text).map(({ item, project }) => ({
        content: item.url,
        description: `<match>${escapeOmniboxText(String(item.title || item.url).slice(0, 100))}</match> <dim>— ${escapeOmniboxText(project || inbox)} · ${escapeOmniboxText(item.source || "")}</dim>`
      }));
      suggest(suggestions);
    }).catch(() => suggest([]));
  });

  chrome.omnibox?.onInputEntered?.addListener((text, disposition) => {
    (async () => {
      const value = String(text || "").trim();
      if (isWebUrl(value)) {
        const stored = await chrome.storage.local.get(STORAGE_KEY);
        const item = (stored[STORAGE_KEY] || []).find((entry) => normalizeUrl(entry.url) === normalizeUrl(value));
        if (item && isWebUrl(item.url)) {
          await chrome.storage.local.set({ [CURRENT_ITEM_KEY]: item.id });
          await openFromOmnibox(item.url, disposition);
          return;
        }
      }
      const url = new URL(chrome.runtime.getURL("library.html"));
      if (value) url.searchParams.set("q", value);
      url.searchParams.set("from", "omnibox");
      await openFromOmnibox(url.href, disposition);
    })().catch(() => {});
  });
}
