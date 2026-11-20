import { browser } from "wxt/browser";
import { WEBDAV_DOWNLOAD_MESSAGE } from "./webdav-download";
import type { BackupImageDamage } from "./archive-images";
import type { WebdavDownloadReply, WebdavFailure } from "./webdav-download";
import type { BackupOptions, BackupStatus, RemoteBackup } from "./webdav-shared";
import type { WebdavPreset } from "../settings/sync-shared";

type ResponseDetails = { readonly status: BackupStatus };

const DOWNLOAD_REPLY_TIMEOUT = 120_000;

function requestError(response?: WebdavFailure): Error {
  return Object.assign(new Error(response?.error || "WEBDAV_FAILED"), { bytes: response?.bytes });
}

async function request<T extends ResponseDetails>(action: string, fields: Readonly<Record<string, unknown>> = {}): Promise<T> {
  const message = { type: "WEBDAV_BACKUP", action, ...fields };
  const response = await browser.runtime.sendMessage<typeof message,
    (T & { readonly ok: true }) | WebdavFailure | undefined>(message);
  if (!response?.ok) throw requestError(response);
  return response;
}

export const webdavStatus = (): Promise<ResponseDetails> => request("status");
export const saveWebdav = (options: BackupOptions, password: string): Promise<ResponseDetails> => request("save", { options, password });
export const testWebdav = (allowOverBudget: boolean): Promise<ResponseDetails> => request("test", { allowOverBudget });
export const testWebdavPreset = (preset: WebdavPreset, password: string, allowOverBudget: boolean):
  Promise<ResponseDetails & { readonly token: string }> => request("testPreset", { preset, password, allowOverBudget });
export const applyWebdavPreset = (preset: WebdavPreset, password: string, token: string): Promise<ResponseDetails> =>
  request("applyPreset", { preset, password, token });
export const listWebdav = (allowOverBudget: boolean): Promise<ResponseDetails & { readonly entries: readonly RemoteBackup[] }> =>
  request("list", { allowOverBudget });
export const uploadWebdav = (includeImages: boolean, allowOverBudget: boolean): Promise<ResponseDetails> =>
  request("backup", { includeImages, allowOverBudget });
export async function downloadWebdav({ device, name }: RemoteBackup, allowOverBudget: boolean):
  Promise<ResponseDetails & { readonly archive: Blob; readonly imageDamage?: BackupImageDamage }> {
  const registration = await navigator.serviceWorker.getRegistration();
  const worker = registration?.active;
  if (!worker) throw requestError();

  const { port1, port2 } = new MessageChannel();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const reply = await new Promise<WebdavDownloadReply>((resolve, reject) => {
    const fail = () => reject(requestError());
    timeout = setTimeout(fail, DOWNLOAD_REPLY_TIMEOUT);
    port1.onmessage = (event: MessageEvent<WebdavDownloadReply>) => resolve(event.data);
    port1.onmessageerror = fail;
    worker.postMessage({ type: WEBDAV_DOWNLOAD_MESSAGE, device, name, allowOverBudget }, [port2]);
  }).finally(() => {
    clearTimeout(timeout);
    port1.close();
    port2.close();
  });
  if (!reply.ok) throw requestError(reply);
  return { archive: new Blob([reply.archive], { type: "application/zip" }), status: reply.status, imageDamage: reply.imageDamage };
}
export const loadWebdavRestore = ({ device, name }: RemoteBackup, allowOverBudget: boolean):
  Promise<ResponseDetails & { readonly payload: unknown; readonly imageDamage?: BackupImageDamage }> => request("restore", { device, name, allowOverBudget });
export const deleteWebdav = ({ device, name }: RemoteBackup, allowOverBudget: boolean): Promise<ResponseDetails> =>
  request("delete", { device, name, allowOverBudget });
