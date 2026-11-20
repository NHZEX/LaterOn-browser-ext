export const MIB = 1024 * 1024;
export const AUTO_BACKUP_LIMIT = 7;
export const BACKUP_STATE = "laterOnWebdavBackup";
export const BACKUP_ALARM = "stayside-webdav-backup";

export interface BackupOptions {
  readonly endpoint: string;
  readonly directory: string;
  readonly username: string;
  readonly automatic: boolean;
  readonly intervalHours: number;
  readonly includeImages: boolean;
  readonly budgetMiB: number;
}

export interface BackupSettings extends BackupOptions {
  readonly password: string;
}

export const DEFAULT_BACKUP_OPTIONS: BackupOptions = {
  endpoint: "", directory: "StaySide", username: "", automatic: false,
  intervalHours: 24, includeImages: false, budgetMiB: 192
};

export type BackupKind = "auto" | "manual";

export interface RemoteBackup {
  readonly device: string;
  readonly name: string;
  readonly kind: BackupKind;
  readonly createdAt: number;
  readonly sequence: number;
  readonly bytes: number | null;
}

export interface BackupUsage {
  readonly month: string;
  readonly uploaded: number;
  readonly uncertainUploaded: number;
  readonly downloaded: number;
  readonly requests: number;
}

export type StoredBackupUsage = Omit<BackupUsage, "uncertainUploaded"> & { readonly uncertainUploaded?: number };

export interface BackupStatus {
  readonly options: BackupOptions;
  readonly configured: boolean;
  readonly device: string;
  readonly usage: BackupUsage;
  readonly lastBackup: number | null;
  readonly lastError: string | null;
  readonly cleanupPending: boolean;
}

const filePattern = /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2}\.\d{3}Z)-(auto|manual)(?:-(\d{2,8}))?\.zip$/;
const devicePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isBackupDevice(value: unknown): value is string {
  return typeof value === "string" && devicePattern.test(value);
}

export function backupFileName(createdAt: number, kind: BackupKind, sequence: number): string {
  const timestamp = new Date(createdAt).toISOString().replaceAll(":", "-");
  const suffix = sequence > 1 ? `-${String(sequence).padStart(2, "0")}` : "";
  return `${timestamp}-${kind}${suffix}.zip`;
}

export function parseBackupName(device: unknown, name: unknown, bytes: number | null = null): RemoteBackup | null {
  if (!isBackupDevice(device) || typeof name !== "string") return null;
  const match = filePattern.exec(name);
  if (!match || (match[4] !== "auto" && match[4] !== "manual")) return null;
  const createdAt = Date.parse(`${match[1]}:${match[2]}:${match[3]}`);
  const sequence = Number(match[5] || 1);
  if (!Number.isFinite(createdAt) || backupFileName(createdAt, match[4], sequence) !== name) return null;
  return { device, name, kind: match[4], createdAt, sequence, bytes };
}

export function newestFirst(left: RemoteBackup, right: RemoteBackup): number {
  return right.createdAt - left.createdAt || right.sequence - left.sequence;
}

export function monthUsage(usage: StoredBackupUsage | undefined, now: number): BackupUsage {
  const month = new Date(now).toISOString().slice(0, 7);
  if (usage?.month !== month) return { month, uploaded: 0, uncertainUploaded: 0, downloaded: 0, requests: 0 };
  if (usage.uncertainUploaded === undefined) return { ...usage, uploaded: 0, uncertainUploaded: usage.uploaded };
  return { ...usage, uncertainUploaded: usage.uncertainUploaded };
}

export function normalizeBackupEndpoint(endpoint: string): string {
  let url: URL;
  try { url = new URL(endpoint.trim()); }
  catch { throw new Error("WEBDAV_SETTINGS"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("WEBDAV_SETTINGS");
  url.pathname = url.pathname.replace(/\/+$/, "") + "/";
  return url.href;
}

export function normalizeBackupOptions(options: BackupOptions): BackupOptions {
  const endpoint = normalizeBackupEndpoint(options.endpoint);
  const directory = options.directory.trim();
  const username = options.username.trim();
  if (!directory || directory === "." || directory === ".." || /[/\\\x00-\x1f]/.test(directory) ||
    !username || username.includes(":") ||
    !Number.isInteger(options.intervalHours) || options.intervalHours < 1 || options.intervalHours > 720 ||
    !Number.isInteger(options.budgetMiB) || options.budgetMiB < 1 || options.budgetMiB > 100000) {
    throw new Error("WEBDAV_SETTINGS");
  }
  return {
    endpoint, directory, username,
    automatic: options.automatic === true, includeImages: options.includeImages === true,
    intervalHours: options.intervalHours, budgetMiB: options.budgetMiB
  };
}
