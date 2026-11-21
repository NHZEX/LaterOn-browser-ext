import { createWebdav } from "../backup/webdav-transport";
import { saveLocalRecovery } from "../backup/background";
import type { RunWebdavTransfer } from "../backup/webdav-background";
import type { TransferMeter } from "../backup/webdav-meter";
import type { WebdavClient } from "../backup/webdav-transport";
import { ITEMS, KEYS, isRecord } from "../storage/contracts";
import type { CollectionState } from "../storage/contracts";
import { commit, enqueue } from "../storage/coordinator";
import { SYNC_ACCEPTANCE_BUILD, SYNC_ACCEPTANCE_MESSAGE, SYNC_META } from "./acceptance";
import type { SyncAcceptanceReply, SyncAcceptanceStatus, SyncJoinPreview } from "./acceptance";
import { detachSyncPatch, readMeta } from "./binding";
import type { PendingPublication, SyncBinding, SyncMeta } from "./binding";
import { createPublication, headName, matchesSyncHead, MAX_HEAD_BYTES, parseSyncHead, verifySyncSnapshot } from "./publication";
import type { SyncHead } from "./publication";
import { hashSyncState, initialSyncState, isDeviceId, mergeSyncStates } from "./state";
import type { SyncState } from "./state";

type StoredSync = CollectionState & { readonly [SYNC_META]?: SyncMeta };

const rejected = (): never => { throw new Error("SYNC_ACCEPTANCE_REJECTED"); };

function acceptanceEndpoint(value: unknown): string {
  if (typeof value !== "string") return rejected();
  const url = new URL(value.trim());
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname === "/") return rejected();
  return url.href.endsWith("/") ? url.href : `${url.href}/`;
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
  const initial = await readMeta();
  if (initial?.binding) return rejected();
  await requireEmpty(davFor(endpoint, meter));
  await enqueue(async () => {
    const previous = await readMeta();
    if (previous?.binding || previous?.detachedId !== initial?.detachedId) return rejected();
    const binding: SyncBinding = { endpoint, collectionId: crypto.randomUUID(), bindingId: crypto.randomUUID() };
    await chrome.storage.local.set({ [SYNC_META]: { deviceId: previous?.deviceId ?? crypto.randomUUID(),
      allocatedSeq: previous?.allocatedSeq ?? 0, binding } satisfies SyncMeta });
  });
}

async function publish(dav: WebdavClient, meta: SyncMeta & { readonly binding: SyncBinding }, state: SyncState): Promise<void> {
  const { binding } = meta;
  const seq = meta.allocatedSeq + 1;
  if (!Number.isSafeInteger(seq)) return rejected();
  const intent = await createPublication({ deviceId: meta.deviceId, collectionId: binding.collectionId, seq }, state);
  const pending = { head: intent.head, baseVersion: intent.head.stateHash } satisfies PendingPublication;
  await enqueue(async () => {
    const current = await requireCurrentBinding(binding);
    if (current.allocatedSeq !== meta.allocatedSeq || current.binding.pending) return rejected();
    await chrome.storage.local.set({ [SYNC_META]: { ...current, allocatedSeq: seq, binding: { ...current.binding, state, pending } } });
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

async function discover(dav: WebdavClient, collectionId: string, seen: readonly SyncHead[] = []) {
  const entries = await dav.list([], true);
  if (!entries) return rejected();
  const names = entries.filter(entry => entry.name.startsWith("head-")).sort((left, right) => left.name < right.name ? -1 : 1);
  if (!names.length) return rejected();
  const heads: SyncHead[] = [];
  let state: SyncState = { members: [], deletedIds: [] };
  for (const { name, directory } of names) {
    if (directory) return rejected();
    const bytes = await dav.get([name], MAX_HEAD_BYTES);
    if (!bytes) return rejected();
    const head = parseSyncHead(bytes);
    if (headName(head.deviceId) !== name || head.collectionId !== collectionId) return rejected();
    const previous = seen.find(entry => entry.deviceId === head.deviceId);
    if (previous && (head.seq < previous.seq || (head.seq === previous.seq && !matchesSyncHead(bytes, previous)))) return rejected();
    const snapshot = await verifySyncSnapshot(await dav.get([head.snapshotName]), head);
    if (snapshot.deletedIds.length) return rejected();
    heads.push(head);
    state = mergeSyncStates(state, snapshot);
  }
  if (seen.some(previous => !heads.some(head => head.deviceId === previous.deviceId))) return rejected();
  return { heads, state };
}

function withLocalAdditions(state: SyncState, stored: CollectionState, deviceId: string): SyncState {
  const known = new Set(state.members.map(member => member.id));
  return mergeSyncStates(state, initialSyncState((stored[ITEMS] ?? []).filter(item => !known.has(item.id)), deviceId));
}

function addItems(stored: CollectionState, state: SyncState, previous?: SyncState): CollectionState {
  const known = new Set([...(stored[ITEMS] ?? []).map(item => item.id), ...(previous?.members ?? []).map(member => member.id)]);
  const added = state.members.filter(member => !known.has(member.id)).map(member => ({ id: member.id,
    url: member.url, savedAt: member.savedAt, title: member.title.value, description: member.description.value }));
  return added.length ? { [ITEMS]: [...stored[ITEMS] ?? [], ...added] } : {};
}

async function evaluateJoin(message: Record<string, unknown>, meter: TransferMeter, confirm: boolean): Promise<SyncJoinPreview | undefined> {
  const endpoint = acceptanceEndpoint(message.endpoint), collectionId = message.collectionId;
  if (!isDeviceId(collectionId)) return rejected();
  const initial = await readMeta();
  if (initial?.binding) return rejected();
  const { heads, state } = await discover(davFor(endpoint, meter), collectionId);
  return enqueue(async () => {
    const stored = await chrome.storage.local.get<StoredSync>([SYNC_META, ...KEYS]);
    const prior = stored[SYNC_META];
    if (prior?.binding || prior?.detachedId !== initial?.detachedId) return rejected();
    const items = stored[ITEMS] ?? [];
    const proofData = JSON.stringify([endpoint, collectionId, prior?.detachedId, heads, items.map(item => item.id)]);
    const proof = JSON.stringify(Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(proofData)))));
    const additions = addItems(stored, state);
    if (!confirm) return { proof, collectionId, local: items.length, incoming: (additions[ITEMS]?.length ?? items.length) - items.length };
    if (message.proof !== proof) return rejected();
    if (items.length || stored.laterOnProjects?.length) await saveLocalRecovery(stored);
    const deviceId = prior?.deviceId ?? crypto.randomUUID();
    const own = heads.find(head => head.deviceId === deviceId);
    const binding: SyncBinding = { endpoint, collectionId, bindingId: crypto.randomUUID(), joined: true,
      state: withLocalAdditions(state, stored, deviceId), seen: heads,
      ...(own ? { confirmed: { head: own, baseVersion: own.stateHash } } : {}) };
    const next = { ...additions, [SYNC_META]: { deviceId, allocatedSeq: Math.max(prior?.allocatedSeq ?? 0, own?.seq ?? 0), binding } };
    await commit(stored, next);
  });
}

async function syncAdditions(binding: SyncBinding, meter: TransferMeter, first: boolean): Promise<void> {
  const dav = davFor(binding.endpoint, meter, binding);
  if (first) {
    if (binding.joined || binding.confirmed || binding.pending) return rejected();
    await requireEmpty(dav);
    const prepared = await enqueue(async () => {
      const current = await requireCurrentBinding(binding);
      const stored = await chrome.storage.local.get<StoredSync>(ITEMS);
      return { current, state: initialSyncState(stored[ITEMS] ?? [], current.deviceId) };
    });
    return publish(dav, prepared.current, prepared.state);
  }
  if ((!binding.joined && !binding.confirmed) || binding.pending) return rejected();
  const peerHeads = (binding.seen ?? []).filter(head => head.deviceId !== binding.confirmed?.head.deviceId);
  const { heads, state } = await discover(dav, binding.collectionId, binding.confirmed ? [...peerHeads, binding.confirmed.head] : peerHeads);
  const prepared = await enqueue(async () => {
    const current = await requireCurrentBinding(binding);
    const stored = await chrome.storage.local.get<StoredSync>([...KEYS]);
    const previous = current.binding.state;
    const merged = withLocalAdditions(previous ? mergeSyncStates(previous, state) : state, stored, current.deviceId);
    const nextBinding: SyncBinding = { ...current.binding, seen: heads, state: merged };
    const next = { ...current, binding: nextBinding };
    const patch = { ...addItems(stored, state, previous), [SYNC_META]: next };
    await commit(stored, patch);
    return { next, state: merged };
  });
  if (await hashSyncState(prepared.state) !== prepared.next.binding.confirmed?.head.stateHash) await publish(dav, prepared.next, prepared.state);
}

function status(binding?: SyncBinding): SyncAcceptanceStatus {
  if (!binding) return "unbound";
  return binding.pending ? "pending" : binding.confirmed ? "verified" : binding.joined ? "joined" : "ready";
}

export function registerSyncAcceptance(runTransfer: RunWebdavTransfer): void {
  if (!SYNC_ACCEPTANCE_BUILD) return;
  const running = new Set<string>();
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (!isRecord(message) || message.type !== SYNC_ACCEPTANCE_MESSAGE || !sender.url?.startsWith(chrome.runtime.getURL("settings.html"))) return;
    const run = async (): Promise<SyncAcceptanceReply> => {
      let preview: SyncJoinPreview | undefined;
      if (message.action === "create") await runTransfer(meter => createLibrary(message.endpoint, meter));
      else if (message.action === "preview" || message.action === "join") {
        preview = await runTransfer(meter => evaluateJoin(message, meter, message.action === "join"));
      } else if (message.action === "unbind") {
        await enqueue(async () => chrome.storage.local.set(await detachSyncPatch()));
      } else if (message.action === "publish" || message.action === "sync") {
        const binding = (await readMeta())?.binding;
        if (!binding || running.has(binding.bindingId)) return rejected();
        running.add(binding.bindingId);
        try { await runTransfer(meter => syncAdditions(binding, meter, message.action === "publish")); }
        finally { running.delete(binding.bindingId); }
      }
      else if (message.action !== "status") return rejected();
      const binding = (await readMeta())?.binding;
      return { ok: true, status: status(binding), collectionId: binding?.collectionId, preview };
    };
    void run().then(respond, () => respond({ ok: false }));
    return true;
  });
}
