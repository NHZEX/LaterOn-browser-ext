import type { Translate } from "../../../src/shared/i18n";

export function clampDays(value: unknown): number {
  const days = Number(value);
  return Number.isFinite(days) ? Math.min(180, Math.max(30, Math.round(days))) : 30;
}

export function backupErrorKey(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  if (code.startsWith("INVALID_BACKUP:")) return "backupInvalid";
  const keys: Readonly<Record<string, string>> = {
    UNSUPPORTED_BACKUP: "backupUnsupported", BACKUP_TOO_LARGE: "backupTooLarge",
    IMPORT_PREVIEW_EXPIRED: "backupPreviewExpired", IMPORT_DATA_CHANGED: "backupDataChanged"
  };
  return keys[code] ?? "backupOperationFailed";
}

export interface DiagnosticsSnapshot {
  readonly laterOnDiag?: {
    readonly lastCommandAt?: number; readonly lastCommand?: string;
    readonly lastResultAt?: number; readonly lastRunAt?: number; readonly lastTrigger?: string;
    readonly lastAdded?: number; readonly lastDuplicated?: number; readonly lastMoved?: number;
    readonly lastEnriched?: number; readonly lastDegraded?: number;
    readonly lastError?: string; readonly lastErrorAt?: number;
    readonly lastStage?: string; readonly lastStageAt?: number; readonly lastProgress?: string;
    readonly lastTabCount?: number; readonly lastCoverAt?: number; readonly lastTitleFrom?: string;
    readonly lastCoverFrom?: string; readonly lastCoverTitle?: string;
  };
  readonly laterOnPanelDiag?: {
    readonly at: number; readonly total: number;
    readonly page?: number; readonly cache?: number; readonly paint?: number;
    readonly data?: number; readonly migrate?: number; readonly other?: number;
    readonly bytes?: number; readonly localStorageSlow?: boolean; readonly cacheHit?: boolean;
    readonly items?: number; readonly slow?: readonly { readonly name: string; readonly ms: number }[];
  };
  readonly laterOnLocateDiag?: {
    readonly at: number; readonly found?: boolean; readonly inView?: boolean;
    readonly scrolled?: boolean; readonly attempts?: number; readonly viewport?: number;
  };
}

export const COMMANDS = [
  { name: "quick-save", id: "cmdSave", label: "cmdSavePage", shortcut: "Alt+1" },
  { name: "toggle-translation", id: "cmdTranslate", label: "cmdTranslatePage", shortcut: "Alt+2" },
  { name: "save-all-tabs", id: "cmdSaveAll", label: "cmdSaveAllTabs", shortcut: "Alt+Shift+1" }
] as const;
const TRIGGERS: Readonly<Record<string, string>> = { shortcut: "triggerShortcut", menu: "triggerMenu", panel: "triggerPanel" };
const COVERS: Readonly<Record<string, string>> = {
  share: "coverShare", image_src: "coverImageSrc", itemprop: "coverItemprop", jsonld: "coverJsonld",
  poster: "coverPoster", background: "coverBackground", lazy: "coverLazy", biggest: "coverBiggest",
  youtube: "coverYoutube", "generic-skipped": "coverGenericSkipped", none: "coverNone"
};
const TITLES: Readonly<Record<string, string>> = {
  "dom-headline": "titleDomHeadline", share: "titleShare", twitter: "titleTwitter", "meta-title": "titleMetaTitle",
  jsonld: "coverJsonld", "page-title": "titlePageTitle", youtube: "titleYoutube", tab: "titleTab", fallback: "titleFallback", none: "titleNone"
};
const SEGMENTS = [
  ["page", "segPage"], ["cache", "segCache"], ["paint", "segPaint"],
  ["data", "segData"], ["migrate", "segMigrate"], ["other", "segOther"]
] as const;

interface DiagnosticRow {
  readonly id: string;
  readonly label: string;
  readonly text: string;
}

export function formatDiagnostics(snapshot: DiagnosticsSnapshot, t: Translate, language: string, now: number): readonly DiagnosticRow[] {
  const isEn = language === "en";
  const relativeTime = (timestamp?: number): string => {
    if (!timestamp) return "";
    const diff = now - timestamp;
    if (diff < 60000) return t("justNow");
    if (diff < 3600000) return t("minutesAgo", { n: Math.floor(diff / 60000) });
    if (diff < 86400000) return t("hoursAgo", { n: Math.floor(diff / 3600000) });
    return new Date(timestamp).toLocaleString(isEn ? "en-US" : "zh-CN");
  };
  const diag = snapshot.laterOnDiag ?? {};
  const panel = snapshot.laterOnPanelDiag;
  const locate = snapshot.laterOnLocateDiag;
  const sourceLabel = (source: string | undefined, keys: Readonly<Record<string, string>>): string =>
    source ? (keys[source] ? t(keys[source]) : source) : t("unknown");
  const panelParts = panel?.at ? [
    relativeTime(panel.at), t("totalSeconds", { n: (panel.total / 1000).toFixed(1) }),
    t(panel.total <= 1000 ? "speedOk" : panel.total <= 2000 ? "speedSlowish" : "speedSlow"),
    ...SEGMENTS.filter(([key]) => (panel[key] ?? 0) > 0).map(([key, label]) => `${t(label)} ${t("msUnit", { n: panel[key] ?? 0 })}`),
    ...(panel.bytes ? [t("dataSizeKB", { n: Math.round(panel.bytes / 1024) })] : []),
    ...(panel.localStorageSlow ? [t("localStorageSlow")] : []),
    ...(panel.cacheHit === undefined ? [] : [t(panel.cacheHit ? "cacheOn" : "cacheOff")]),
    ...(panel.items == null ? [] : [t("itemsCount", { n: panel.items })]),
    ...(Array.isArray(panel.slow) && panel.slow.length ? [t("slowestFiles", { list: panel.slow.map(entry => `${entry.name} ${t("msUnit", { n: entry.ms })}`).join(isEn ? ", " : "、") })] : [])
  ] : [t("panelNever")];
  const locateParts = locate?.at ? [
    relativeTime(locate.at),
    ...(locate.found === false ? [t("locateNotFound")] : [
      t(locate.inView === false ? "locateOutOfView" : "locateInView"),
      ...(locate.scrolled === false ? [t("locateNoScroll")] : []),
      ...(locate.attempts == null ? [] : [t("locateAttempts", { n: locate.attempts })])
    ]),
    ...(locate.viewport ? [t("viewportPx", { n: locate.viewport })] : [])
  ] : [t("locateNever")];
  const runAt = diag.lastResultAt || diag.lastRunAt;
  const trigger = diag.lastTrigger || "shortcut";
  const run = runAt ? [
    relativeTime(runAt), t("fromTrigger", { trigger: TRIGGERS[trigger] ? t(TRIGGERS[trigger]) : trigger }),
    t("addedCount", { n: diag.lastAdded ?? 0 }), t("duplicateCount", { n: diag.lastDuplicated ?? 0 }),
    ...(diag.lastMoved ? [t("movedCount", { n: diag.lastMoved })] : []),
    ...(diag.lastEnriched ? [t("enrichedCount", { n: diag.lastEnriched })] : []),
    ...(diag.lastDegraded ? [t("degradedCount", { n: diag.lastDegraded })] : [])
  ].join(" · ") : t("neverRan");
  const stage = diag.lastStage ? [
    t("stageLine", { stage: diag.lastStage, time: relativeTime(diag.lastStageAt || diag.lastRunAt) }),
    ...(diag.lastProgress ? [t("progressLabel", { p: diag.lastProgress })] : []),
    ...(diag.lastTabCount == null ? [] : [t("tabCount", { n: diag.lastTabCount })])
  ].join(" · ") : t("neverRan");
  const titleSuffix = diag.lastCoverTitle ? (isEn ? ` (${diag.lastCoverTitle})` : `（${diag.lastCoverTitle}）`) : "";
  return [
    { id: "diagShortcut", label: "lastShortcut", text: diag.lastCommandAt ? t("shortcutLine", {
      time: relativeTime(diag.lastCommandAt), cmd: t(COMMANDS.find(command => command.name === diag.lastCommand)?.label ?? diag.lastCommand ?? "")
    }) : t("neverTriggered") },
    { id: "diagRun", label: "lastSaveAll", text: run },
    { id: "diagStage", label: "lastStage", text: stage },
    { id: "diagCover", label: "lastCoverSource", text: diag.lastCoverAt ? [relativeTime(diag.lastCoverAt),
      t("coverLine", { title: sourceLabel(diag.lastTitleFrom, TITLES), cover: sourceLabel(diag.lastCoverFrom, COVERS) }) + titleSuffix].join(" · ") : t("coverNever") },
    { id: "diagPanelSpeed", label: "panelSpeedLabel", text: panelParts.join(" · ") },
    { id: "diagLocate", label: "panelLocateLabel", text: locateParts.join(" · ") },
    ...(diag.lastError ? [{ id: "diagError", label: "lastErrorLabel", text: t("errorLine", { time: relativeTime(diag.lastErrorAt), msg: diag.lastError }) }] : [])
  ];
}
