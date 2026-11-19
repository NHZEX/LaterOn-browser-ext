import type { BackupImageDamage } from "./archive-images";
import type { BackupStatus } from "./webdav-shared";

export const WEBDAV_DOWNLOAD_MESSAGE = "WEBDAV_DOWNLOAD";

export interface WebdavFailure {
  readonly ok: false;
  readonly error: string;
  readonly bytes?: number;
}

export interface WebdavDownloadSuccess {
  readonly ok: true;
  readonly archive: Uint8Array<ArrayBuffer>;
  readonly status: BackupStatus;
  readonly imageDamage?: BackupImageDamage;
}

export type WebdavDownloadReply = WebdavDownloadSuccess | WebdavFailure;
