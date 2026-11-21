import { createWebdav } from "../backup/webdav-transport";
import type { RunWebdavTransfer } from "../backup/webdav-background";
import type { TransferMeter } from "../backup/webdav-meter";
import type { WebdavClient } from "../backup/webdav-transport";
import { ITEMS, isRecord } from "../storage/contracts";
import type { CollectionState } from "../storage/contracts";
import { enqueue } from "../storage/coordinator";
import { SYNC_ACCEPTANCE_BUILD, SYNC_ACCEPTANCE_MESSAGE } from "./acceptance";
import type { SyncAcceptanceReply, SyncAcceptanceStatus } from "./acceptance";
import { createPublication, headName, matchesSyncHead, MAX_HEAD_BYTES, verifySyncSnapshot } from "./publication";
import type { SyncHead } from "./publication";
import { initialSyncState } from "./state";

const SYNC_META = "laterOnSyncMeta";
interface PendingPublication {
  readonly head: SyncHead;
  readonly baseVersion: string;
}
interface SyncBinding {
  readonly endpoint: string;
  readonly collectionId: string;
  readonly bindingId: string;
  readonly pending?: PendingPublication;
  readonly confirmed?: PendingPublication;
}
interface SyncMeta {
  readonly deviceId: string;
  readonly allocatedSeq: number;
  readonly binding?: SyncBinding;
}
type StoredSync = CollectionState & { readonly [SYNC_META]?: SyncMeta };

const rejected = (): never => { throw new Error("SYNC_ACCEPTANCE_REJECTED"); };

function acceptanceEndpoint(value: unknown): string {
  if (typeof value !== "string") return rejected();
  const url = new URL(value.trim());
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname === "/") return rejected();
  return url.href.endsWith("/") ? url.href : `${url.href}/`;
}

async function readMeta(): Promise<SyncMeta | undefined> {
  return (await chrome.storage.local.get<StoredSync>(SYNC_META))[SYNC_META];
}

async function requireCurrentBinding(expected: SyncBinding): Promise<SyncMeta & { readonly binding: SyncBinding }> {
  const meta = await readMeta();
  if (!meta?.binding || meta.binding.bindingId !== expected.bindingId || meta.binding.collectionId !== expected.collectionId) return rejected();
  return { ...meta, binding: meta.binding };
}

function davFor(endpoint: string, meter: TransferMeter, binding?: SyncBinding): WebdavClient {
  return createWebdav({ endpoint: acceptanceEndpoint(endpoint), username: "", password: "" }, meter, async (input, options) => {
    if (options?.method !== "PUT" || !binding) return fetch(input, options);
    const dispatched = await enqueue(async () => {
      await requireCurrentBinding(binding);
      return { response: fetch(input, options) };
    });
    return dispatched.response;
  });
}

async function requireEmpty(dav: WebdavClient): Promise<void> {
  const entries = await dav.list([], true);
  if (!entries || entries.length !== 0) rejected();
}

async function createLibrary(value: unknown, meter: TransferMeter): Promise<void> {
  const endpoint = acceptanceEndpoint(value);
  if ((await readMeta())?.binding) return rejected();
  await requireEmpty(davFor(endpoint, meter));
  await enqueue(async () => {
    const previous = await readMeta();
    if (previous?.binding) return rejected();
    const binding: SyncBinding = { endpoint, collectionId: crypto.randomUUID(), bindingId: crypto.randomUUID() };
    await chrome.storage.local.set({ [SYNC_META]: { deviceId: previous?.deviceId ?? crypto.randomUUID(),
      allocatedSeq: previous?.allocatedSeq ?? 0, binding } satisfies SyncMeta });
  });
}

async function publishFirstSnapshot(meter: TransferMeter): Promise<void> {
  const stored = await enqueue(() => chrome.storage.local.get<StoredSync>([SYNC_META, ITEMS]));
  const meta = stored[SYNC_META], binding = meta?.binding;
  if (!meta || !binding || binding.pending || binding.confirmed) return rejected();
  const dav = davFor(binding.endpoint, meter, binding);
  await requireEmpty(dav);
  const state = initialSyncState(stored[ITEMS] ?? [], meta.deviceId);
  const seq = meta.allocatedSeq + 1;
  if (!Number.isSafeInteger(seq)) return rejected();
  const intent = await createPublication({ deviceId: meta.deviceId, collectionId: binding.collectionId, seq }, state);
  const pending = { head: intent.head, baseVersion: intent.head.stateHash } satisfies PendingPublication;
  await enqueue(async () => {
    const current = await requireCurrentBinding(binding);
    if (current.allocatedSeq !== meta.allocatedSeq || current.binding.pending || current.binding.confirmed) return rejected();
    await chrome.storage.local.set({ [SYNC_META]: { ...current, allocatedSeq: seq, binding: { ...current.binding, pending } } });
  });
  await dav.put([intent.head.snapshotName], intent.snapshotBytes, "application/gzip");
  const index = [headName(meta.deviceId)];
  await dav.put(index, intent.headBytes, "application/json");
  if (!matchesSyncHead(await dav.get(index, MAX_HEAD_BYTES), intent.head)) return rejected();
  await verifySyncSnapshot(await dav.get([intent.head.snapshotName]), intent.head);
  await enqueue(async () => {
    const current = await requireCurrentBinding(binding);
    const { pending: active, ...rest } = current.binding;
    if (active?.head.seq !== seq || active.head.stateHash !== intent.head.stateHash) return rejected();
    await chrome.storage.local.set({ [SYNC_META]: { ...current, binding: { ...rest, confirmed: pending } } });
  });
}

async function status(): Promise<SyncAcceptanceStatus> {
  const binding = (await readMeta())?.binding;
  if (!binding) return "unbound";
  return binding.confirmed ? "verified" : binding.pending ? "pending" : "ready";
}

export function registerSyncAcceptance(runTransfer: RunWebdavTransfer): void {
  if (!SYNC_ACCEPTANCE_BUILD) return;
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (!isRecord(message) || message.type !== SYNC_ACCEPTANCE_MESSAGE || !sender.url?.startsWith(chrome.runtime.getURL("settings.html"))) return;
    const run = async (): Promise<SyncAcceptanceReply> => {
      if (message.action === "create") await runTransfer(meter => createLibrary(message.endpoint, meter));
      else if (message.action === "publish") await runTransfer(publishFirstSnapshot);
      else if (message.action !== "status") return rejected();
      return { ok: true, status: await status() };
    };
    void run().then(respond, () => respond({ ok: false }));
    return true;
  });
}
