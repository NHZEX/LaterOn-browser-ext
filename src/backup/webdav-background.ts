import { createLocalBackup } from "./background";
import { isRecord } from "../storage/contracts";
import { sharesWebdavPreset } from "../settings/sync-background";
import { selectPreset } from "../settings/sync-shared";
import type { WebdavPreset } from "../settings/sync-shared";
import { ARCHIVE_VERSION, createBackupArchive, readBackupArchive } from "./webdav-archive";
import { WEBDAV_DOWNLOAD_MESSAGE } from "./webdav-download";
import type { WebdavDownloadSuccess, WebdavFailure } from "./webdav-download";
import { budgetError, createWebdav } from "./webdav-transport";
import type { DavEntry, WebdavClient } from "./webdav-transport";
import {
  AUTO_BACKUP_LIMIT, BACKUP_ALARM, BACKUP_STATE, DEFAULT_BACKUP_OPTIONS, MIB,
  backupFileName, isBackupDevice, monthUsage, newestFirst, normalizeBackupOptions, parseBackupName
} from "./webdav-shared";
import type { BackupKind, BackupSettings, BackupStatus, BackupUsage, RemoteBackup } from "./webdav-shared";

interface StatusState {
  readonly device: string;
  readonly settings?: BackupSettings;
  readonly usage?: BackupUsage;
  readonly lastBackup?: number;
  readonly automatic?: { readonly at: number; readonly fingerprint: string; readonly archiveVersion?: number };
  readonly nextAutomaticCheckAt?: number;
  readonly error?: string;
  readonly rotationCheckedAt?: number;
  readonly cleanupPending?: boolean;
}

interface StoredBackupState {
  readonly [BACKUP_STATE]?: StatusState & { readonly after?: number };
}

const HOUR = 3_600_000;
const ROTATION_INTERVAL = 24 * HOUR;
const STAGING_RETENTION = 48 * HOUR;
const STAGING_SUFFIX = ".upload";
const CHECK_MINUTES = 30;
const TESTED_PRESET = "laterOnTestedWebdavPreset";
const encode = (value: string) => new TextEncoder().encode(value);

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return "WEBDAV_FAILED";
  return /^(?:WEBDAV_[A-Z_0-9]+|BACKUP_TOO_LARGE|UNSUPPORTED_BACKUP|MISSING_LOCAL_ICON)$/.test(error.message)
    ? error.message : "WEBDAV_FAILED";
}

function failure(error: unknown): WebdavFailure {
  return { ok: false, error: errorCode(error), ...(isRecord(error) && typeof error.bytes === "number" ? { bytes: error.bytes } : {}) };
}

async function fingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function presetProof(token: string, settings: BackupSettings): Promise<string> {
  return fingerprint(JSON.stringify([token, selectPreset(settings), settings.password]));
}

function publicState(state: StatusState): BackupStatus {
  const options = state.settings ? (({ password: _password, ...rest }) => rest)(state.settings) : DEFAULT_BACKUP_OPTIONS;
  return {
    options, configured: !!state.settings, device: state.device, usage: monthUsage(state.usage, Date.now()),
    lastBackup: state.lastBackup ?? null, lastError: state.error || null, cleanupPending: state.cleanupPending === true
  };
}

function requestSettings(raw: unknown, password: unknown, previous?: BackupSettings): BackupSettings {
  if (!isRecord(raw) || typeof raw.endpoint !== "string" || typeof raw.directory !== "string" ||
    typeof raw.username !== "string" || typeof raw.intervalHours !== "number" || typeof raw.budgetMiB !== "number") {
    throw new Error("WEBDAV_SETTINGS");
  }
  const options = normalizeBackupOptions({
    endpoint: raw.endpoint, directory: raw.directory, username: raw.username,
    automatic: raw.automatic === true, includeImages: raw.includeImages === true,
    intervalHours: raw.intervalHours, budgetMiB: raw.budgetMiB
  });
  const retained = previous?.endpoint === options.endpoint && previous.username === options.username
    ? previous.password : "";
  const effectivePassword = typeof password === "string" && password ? password : retained;
  if (!effectivePassword) throw new Error("WEBDAV_SETTINGS");
  return { ...options, password: effectivePassword };
}

function createBackupAlarm(): Promise<void> | undefined {
  return chrome.alarms?.create?.(BACKUP_ALARM, { delayInMinutes: 1, periodInMinutes: CHECK_MINUTES });
}

function sameBackupTarget(previous: BackupSettings | undefined, next: BackupSettings): boolean {
  return previous?.endpoint === next.endpoint && previous.directory === next.directory && previous.username === next.username;
}

function requestPreset(raw: unknown, password: unknown, previous?: BackupSettings): BackupSettings {
  if (!isRecord(raw)) throw new Error("WEBDAV_SETTINGS");
  const options = requestSettings({ ...raw, automatic: previous?.automatic ?? false,
    budgetMiB: previous?.budgetMiB ?? DEFAULT_BACKUP_OPTIONS.budgetMiB }, password, previous);
  return sameBackupTarget(previous, options) ? options : { ...options, automatic: false };
}

async function saveBackupSettings(state: StatusState, settings: BackupSettings): Promise<StatusState> {
  const updated = sameBackupTarget(state.settings, settings) ? { ...state, settings, nextAutomaticCheckAt: 0, error: "" }
    : { device: state.device, usage: state.usage, settings };
  await chrome.storage.local.set({ [BACKUP_STATE]: updated });
  if (settings.automatic) await createBackupAlarm();
  else await chrome.alarms?.clear?.(BACKUP_ALARM);
  return updated;
}

function backupEntries(device: string, entries: readonly DavEntry[]): readonly RemoteBackup[] {
  return entries.flatMap(entry => {
    if (entry.directory) return [];
    const usable = parseBackupName(device, entry.name, entry.bytes);
    return usable ? [usable] : [];
  });
}

async function listBackups(dav: WebdavClient, root: readonly string[]): Promise<readonly RemoteBackup[]> {
  const devices = (await dav.list(root) ?? []).filter(entry => entry.directory && isBackupDevice(entry.name));
  const entries: RemoteBackup[] = [];
  for (const { name } of devices) entries.push(...backupEntries(name, await dav.list([...root, name]) ?? []));
  return entries.sort(newestFirst);
}

function expiredStagingFiles(device: string, entries: readonly DavEntry[], expiresBefore: number): readonly string[] {
  return entries.flatMap(entry => {
    if (entry.directory || !entry.name.startsWith(".") || !entry.name.endsWith(STAGING_SUFFIX)) return [];
    const backup = parseBackupName(device, entry.name.slice(1, -STAGING_SUFFIX.length));
    return backup?.sequence === 1 && backup.createdAt < expiresBefore ? [entry.name] : [];
  });
}

function obsoleteAutomaticBackups(device: string, entries: readonly DavEntry[], latest: string): readonly string[] {
  // Always keep the newly published snapshot, even if the device clock moved backwards.
  const older = backupEntries(device, entries).filter(entry => entry.kind === "auto" && entry.name !== latest).sort(newestFirst);
  return older.slice(AUTO_BACKUP_LIMIT - 1).reverse().map(entry => entry.name);
}

async function prepareBackupFolder(
  dav: WebdavClient, root: readonly string[], folder: readonly string[], checkRotation: boolean
): Promise<readonly DavEntry[] | undefined> {
  if (checkRotation) {
    try {
      const entries = await dav.list(folder);
      if (entries) return entries;
    } catch (error) {
      // Listing problems defer cleanup. Checking the directory itself can still allow a backup.
      if (!/^(?:WEBDAV_LIST(?:_LIMIT)?|WEBDAV_DIRECTORY|WEBDAV_HTTP_(?:403|405|501))$/.test(errorCode(error))) throw error;
      if (await dav.hasDirectory(folder)) return undefined;
    }
  } else if (await dav.hasDirectory(folder)) return undefined;

  await dav.directory(root.slice(0, -1));
  await dav.directory(root);
  await dav.directory(folder);
  return [];
}

async function publish(
  dav: WebdavClient, folder: readonly string[], kind: BackupKind, createdAt: number, archive: Uint8Array<ArrayBuffer>
): Promise<string> {
  const staging = [...folder, `.${backupFileName(createdAt, kind, 1)}${STAGING_SUFFIX}`];
  await dav.put(staging, archive);
  for (let sequence = 1; sequence <= 32; sequence += 1) {
    const name = backupFileName(createdAt, kind, sequence);
    const result = await dav.move(staging, [...folder, name]);
    if (result === "moved") return name;
    if (result === "missing") throw new Error("WEBDAV_PUBLISH");
  }
  throw new Error("WEBDAV_NAME");
}

export function registerWebdavBackup(sharePreset: (preset: WebdavPreset) => Promise<void>): void {
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = (task: () => Promise<unknown>) => {
    const next = queue.then(task);
    queue = next.catch(() => {});
    return next;
  };

  async function run(message: Readonly<Record<string, unknown>>,
    sendDownload?: (reply: WebdavDownloadSuccess) => void): Promise<object> {
    const stored = await chrome.storage.local.get<StoredBackupState>(BACKUP_STATE);
    const { after, ...current } = stored[BACKUP_STATE] ?? { device: crypto.randomUUID() };
    const nextAutomaticCheckAt = current.nextAutomaticCheckAt ?? after;
    let state: StatusState = nextAutomaticCheckAt === undefined ? current : { ...current, nextAutomaticCheckAt };
    const update = async (patch: Partial<StatusState>) => {
      state = { ...state, ...patch };
      await chrome.storage.local.set({ [BACKUP_STATE]: state });
    };

    if (message.action === "status") return { status: publicState(state) };
    if (message.action === "save") {
      const next = requestSettings(message.options, message.password, state.settings);
      const saved = await saveBackupSettings(state, next);
      await sharePreset(next).catch(() => {});
      return { status: publicState(saved) };
    }

    const draft = message.action === "testPreset" || message.action === "applyPreset";
    if (draft && !await sharesWebdavPreset()) throw new Error("WEBDAV_PRESET_TEST");
    const settings = draft ? requestPreset(message.preset, message.password, state.settings) : state.settings;
    const automatic = message.action === "automatic";
    if (automatic && (!settings?.automatic || (state.nextAutomaticCheckAt ?? 0) > Date.now())) return {};
    if (!settings) throw new Error("WEBDAV_SETTINGS");
    if (message.action === "applyPreset") {
      const token = message.token;
      if (typeof token !== "string" || !token) throw new Error("WEBDAV_PRESET_TEST");
      const stored = await chrome.storage.session.get<{ [TESTED_PRESET]?: string }>(TESTED_PRESET);
      if (stored[TESTED_PRESET] !== await presetProof(token, settings)) throw new Error("WEBDAV_PRESET_TEST");
      const saved = await saveBackupSettings(state, settings);
      await chrome.storage.session.remove(TESTED_PRESET);
      return { status: publicState(saved) };
    }
    const limit = settings.budgetMiB * MIB;
    const usage = () => monthUsage(state.usage, Date.now());
    const remaining = () => message.allowOverBudget === true && !automatic ? Infinity :
      Math.max(0, limit - usage().uploaded - usage().downloaded);
    const ensureBudget = (bytes: number) => {
      if (remaining() === 0 || bytes > remaining()) throw budgetError(bytes);
    };
    const dav = createWebdav(settings, {
      remaining,
      async start(uploaded) {
        if (uploaded > remaining()) throw budgetError(uploaded);
        const last = usage();
        await update({ usage: { ...last, requests: last.requests + 1, uploaded: last.uploaded + uploaded } });
      },
      async downloaded(bytes) {
        if (bytes) {
          const last = usage();
          await update({ usage: { ...last, downloaded: last.downloaded + bytes } });
        }
      }
    });
    const root = [settings.directory, "backups"];
    const folder = [...root, state.device];

    async function finishRotation(entries: readonly DavEntry[], latest: string, publishedAt: number): Promise<void> {
      try {
        const names = [
          ...obsoleteAutomaticBackups(state.device, entries, latest),
          ...expiredStagingFiles(state.device, entries, publishedAt - STAGING_RETENTION)
        ];
        for (const name of names) await dav.remove([...folder, name]);
        await update({ cleanupPending: false });
      } catch {
        // Publication is complete. Retry cleanup with the next eligible automatic backup.
      }
    }

    async function submit(kind: BackupKind, includeImages: boolean): Promise<string | null> {
      const payload = await createLocalBackup(includeImages);
      const digest = kind === "auto" ? await fingerprint(JSON.stringify(payload.data)) : null;
      if (state.automatic?.archiveVersion === ARCHIVE_VERSION && digest === state.automatic.fingerprint) return null;
      const archive = await createBackupArchive(payload, includeImages);
      ensureBudget(archive.byteLength);
      const checkRotation = kind === "auto" &&
        (state.rotationCheckedAt === undefined || Date.now() - state.rotationCheckedAt >= ROTATION_INTERVAL);
      const entries = await prepareBackupFolder(dav, root, folder, checkRotation);
      const name = await publish(dav, folder, kind, Date.parse(payload.exportedAt), archive);
      const at = Date.now();
      await update({
        lastBackup: at, nextAutomaticCheckAt: 0, error: "",
        ...(digest === null ? {} : { automatic: { at, fingerprint: digest, archiveVersion: ARCHIVE_VERSION } }),
        ...(checkRotation ? { rotationCheckedAt: at, cleanupPending: true } : {})
      });
      if (checkRotation && entries) await finishRotation(entries, name, at);
      return name;
    }

    if (automatic) {
      try {
        if (state.automatic && Date.now() < state.automatic.at + settings.intervalHours * HOUR) return {};
        const name = await submit("auto", settings.includeImages);
        if (!name) await update({ nextAutomaticCheckAt: Date.now() + CHECK_MINUTES * 60_000, error: "" });
      } catch (error) {
        await update({ nextAutomaticCheckAt: Date.now() + CHECK_MINUTES * 60_000, error: errorCode(error) });
      }
      return {};
    }

    if (message.action === "test") {
      await dav.test();
      return { status: publicState(state) };
    }
    if (message.action === "testPreset") {
      await dav.test();
      const token = crypto.randomUUID();
      // Session storage keeps the test valid across service-worker restarts.
      await chrome.storage.session.set({ [TESTED_PRESET]: await presetProof(token, settings) });
      return { token, status: publicState(state) };
    }
    if (message.action === "list") {
      const entries = await listBackups(dav, root);
      return { entries, status: publicState(state) };
    }
    if (message.action === "backup") {
      const name = await submit("manual", message.includeImages === true);
      return { name, status: publicState(state) };
    }
    const entry = parseBackupName(message.device, message.name);
    if (!entry) throw new Error("WEBDAV_NAME");
    const path = [...root, entry.device, entry.name];
    if (message.action === "delete") {
      await dav.remove(path);
      return { status: publicState(state) };
    }
    if (message.action === "download" || message.action === "restore") {
      const data = await dav.get(path);
      if (data === null) throw new Error("WEBDAV_HTTP_404");
      const { payload, imageDamage } = await readBackupArchive(data);
      const status = publicState(state);
      if (message.action === "restore") return { payload, status, imageDamage };
      if (!sendDownload) throw new Error("WEBDAV_FAILED");
      sendDownload({ ok: true, archive: data, status, imageDamage });
      return {};
    }
    throw new Error("WEBDAV_FAILED");
  }

  const schedule = () => {
    void serialize(async () => {
      const stored = await chrome.storage.local.get<StoredBackupState>(BACKUP_STATE);
      if (!stored[BACKUP_STATE]?.settings?.automatic) return;
      if (!(await chrome.alarms?.get?.(BACKUP_ALARM))) await createBackupAlarm();
      await run({ action: "automatic" });
    }).catch(() => {});
  };
  chrome.alarms?.onAlarm?.addListener(alarm => {
    if (alarm.name === BACKUP_ALARM) void serialize(() => run({ action: "automatic" })).catch(() => {});
  });
  chrome.runtime.onStartup?.addListener(schedule);
  // Drop the obsolete upload cache even when an unpacked extension is reloaded.
  void chrome.storage.local.remove?.("laterOnWebdavBackupPending")?.catch(() => {});
  schedule();

  globalThis.addEventListener?.("message", (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (!isRecord(message) || message.type !== WEBDAV_DOWNLOAD_MESSAGE) return;
    const port = event.ports[0];
    if (!port) return;
    const source = event.source;
    if (!isRecord(source) || typeof source.url !== "string" || !source.url.startsWith(chrome.runtime.getURL(""))) {
      port.postMessage(failure(undefined));
      port.close();
      return;
    }
    const task = serialize(() => run({ ...message, action: "download" }, reply => {
      port.postMessage(reply, [reply.archive.buffer]);
    })).catch(error => port.postMessage(failure(error))).finally(() => port.close());
    if ("waitUntil" in event && typeof event.waitUntil === "function") event.waitUntil(task);
  });

  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (!isRecord(message) || message.type !== "WEBDAV_BACKUP") return;
    if (!sender.url?.startsWith(chrome.runtime.getURL("")) || message.action === "automatic" || message.action === "download") {
      respond({ ok: false, error: "WEBDAV_FAILED" });
      return;
    }
    serialize(async () => ({ ok: true, ...await run(message) })).then(respond).catch(error => respond(failure(error)));
    return true;
  });
}
