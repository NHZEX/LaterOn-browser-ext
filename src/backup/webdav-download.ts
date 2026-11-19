import type { BackupStatus } from "./webdav-shared";

export const WEBDAV_DOWNLOAD_MESSAGE = "WEBDAV_DOWNLOAD";

export interface WebdavFailure {
  readonly ok: false;
  readonly error: string;
  readonly bytes?: number;
}

export type WebdavDownloadReply =
  | { readonly ok: true; readonly archive: Uint8Array<ArrayBuffer>; readonly status: BackupStatus }
  | WebdavFailure;
