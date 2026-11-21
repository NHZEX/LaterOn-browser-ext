import { monthUsage } from "./webdav-shared";
import type { BackupUsage, StoredBackupUsage } from "./webdav-shared";

export interface TransferMeter {
  start(bytes: number): Promise<(() => Promise<void>) | undefined>;
  downloaded(bytes: number): Promise<void>;
  remaining(): number;
}

export function budgetError(bytes: number): Error & { readonly bytes: number } {
  return Object.assign(new Error("WEBDAV_BUDGET"), { bytes });
}

export function createWebdavMeter(limit: number, read: () => StoredBackupUsage | undefined, save: (usage: BackupUsage) => Promise<void>, now = Date.now): TransferMeter & {
  readonly confirm: (bytes: number, startedAt: number) => Promise<void>;
} {
  const remaining = (usage: BackupUsage) => Math.max(0, limit - usage.uploaded - usage.downloaded - usage.uncertainUploaded);
  async function confirm(bytes: number, startedAt: number): Promise<void> {
    const current = read();
    if (current?.month !== monthUsage(undefined, startedAt).month) return;
    const counted = monthUsage(current, startedAt);
    await save({ ...counted, uploaded: counted.uploaded + bytes, uncertainUploaded: counted.uncertainUploaded - bytes });
  }

  return {
    confirm,
    remaining: () => remaining(monthUsage(read(), now())),
    async start(bytes) {
      const startedAt = now();
      const usage = monthUsage(read(), startedAt);
      if (bytes > remaining(usage)) throw budgetError(bytes);
      await save({ ...usage, uncertainUploaded: usage.uncertainUploaded + bytes, requests: usage.requests + 1 });
      if (!bytes) return undefined;

      return () => confirm(bytes, startedAt);
    },
    async downloaded(bytes) {
      if (!bytes) return;
      const usage = monthUsage(read(), now());
      await save({ ...usage, downloaded: usage.downloaded + bytes });
    }
  };
}
