import { createWebdav } from "../backup/webdav-transport";
import { saveLocalRecovery } from "../backup/background";
import type { RunWebdavTransfer } from "../backup/webdav-background";
import type { TransferMeter } from "../backup/webdav-meter";
import type { WebdavClient } from "../backup/webdav-transport";
import { CURRENT, ITEMS, KEYS, OVERRIDE_LOG, isRecord } from "../storage/contracts";
import type { CollectionState } from "../storage/contracts";
import { commit, enqueue } from "../storage/coordinator";
import { appendEditRecovery, readEditRecovery } from "../storage/edit-recovery";
import { itemRemovalPatch } from "../storage/item-deletion";
import { SYNC_ACCEPTANCE_BUILD, SYNC_ACCEPTANCE_MESSAGE, SYNC_META } from "./acceptance";
import type { SyncAcceptanceReply, SyncAcceptanceStatus, SyncJoinPreview } from "./acceptance";
import { detachSyncPatch, readMeta, verifiedHeads } from "./binding";
import type { PendingPublication, SyncBinding, SyncMeta } from "./binding";
import { createPublication, encodeSyncHead, headName, MAX_HEAD_BYTES, parseSyncHead, sameSyncHead, snapshotName, verifySyncSnapshot } from "./publication";
import type { SyncHead } from "./publication";
import { hashSyncState, initialSyncState, isDeviceId, maxClock, mergeSyncStates, stateClock, zeroClock } from "./state";
import type { SyncState } from "./state";
import { receiveSyncText } from "./text-edit";

type StoredSync = CollectionState & { readonly [SYNC_META]?: SyncMeta };
type BoundMeta = SyncMeta & { readonly binding: SyncBinding };
interface Discovered {
  readonly heads: readonly SyncHead[];
  readonly state: SyncState;
  readonly clock: ReturnType<typeof stateClock>;
}

const rejected = (): never => { throw new Error("SYNC_ACCEPTANCE_REJECTED"); };
const safetyPause = (): never => { throw new Error("SYNC_SAFETY_PAUSE"); };
const emptyState: SyncState = { members: [], deletedIds: [] };

function acceptanceEndpoint(value: unknown): string {
  if (typeof value !== "string") return rejected();
  const url = new URL(value.trim());
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname === "/") return rejected();
  return url.href.endsWith("/") ? url.href : `${url.href}/`;
}

async function requireCurrentBinding(expected: SyncBinding): Promise<BoundMeta> {
  const meta = await readMeta();
  if (!meta?.binding || meta.binding.bindingId !== expected.bindingId || meta.binding.collectionId !== expected.collectionId) return rejected();
  return { ...meta, binding: meta.binding };
}

function davFor(endpoint: string, meter: TransferMeter, binding?: SyncBinding): WebdavClient {
  return createWebdav({ endpoint: acceptanceEndpoint(endpoint), username: "", password: "" }, meter, async (input, options) => {
    if (!binding || (options?.method !== "PUT" && options?.method !== "DELETE")) return fetch(input, options);
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
    await chrome.storage.local.set({ [SYNC_META]: { ...(previous?.clock ? { clock: previous.clock } : {}), deviceId: previous?.deviceId ?? crypto.randomUUID(),
      allocatedSeq: previous?.allocatedSeq ?? 0, binding } satisfies SyncMeta });
  });
}

async function pauseCurrentBinding(expected: SyncBinding): Promise<void> {
  await enqueue(async () => {
    const current = await readMeta();
    if (current?.binding?.bindingId !== expected.bindingId || current.binding.collectionId !== expected.collectionId || current.binding.paused) return;
    await chrome.storage.local.set({ [SYNC_META]: { ...current, binding: { ...current.binding, paused: true } } });
  });
}

async function readIndex(dav: WebdavClient, name: string, collectionId: string): Promise<SyncHead | null> {
  const bytes = await dav.get([name], MAX_HEAD_BYTES);
  if (!bytes) return null;
  let head: SyncHead;
  try { head = parseSyncHead(bytes); }
  catch { return safetyPause(); }
  if (headName(head.deviceId) !== name || head.collectionId !== collectionId) return safetyPause();
  return head;
}

async function readSnapshot(dav: WebdavClient, head: SyncHead): Promise<SyncState | undefined> {
  const bytes = await dav.get([head.snapshotName]);
  return verifySyncSnapshot(bytes, head).catch(() => undefined);
}

const asPublication = (head: SyncHead): PendingPublication => ({ head, baseVersion: head.stateHash });
const indexMatches = (observed: SyncHead | null, expected?: SyncHead): boolean => expected
  ? observed !== null && sameSyncHead(observed, expected) : observed === null;

function confirmHead(binding: SyncBinding, head: SyncHead): SyncBinding {
  const locallyPublished = binding.pending && sameSyncHead(binding.pending.head, head);
  return { ...binding, confirmed: asPublication(head),
    ...(locallyPublished ? { publishedSnapshots: [...(binding.publishedSnapshots ?? []), head.seq] } : {}) };
}

async function publishIndex(dav: WebdavClient, binding: SyncBinding, pending: PendingPublication, baseline?: SyncHead): Promise<boolean> {
  const { head } = pending;
  const index = headName(head.deviceId);
  const observed = await readIndex(dav, index, head.collectionId);
  if (!indexMatches(observed, head)) {
    if (!indexMatches(observed, baseline)) return safetyPause();
    await dav.put([index], encodeSyncHead(head), "application/json");
  }
  if (!await readSnapshot(dav, head)) return safetyPause();
  const readback = await readIndex(dav, index, head.collectionId);
  if (!indexMatches(readback, head)) return safetyPause();
  return enqueue(async () => {
    const current = await requireCurrentBinding(binding);
    const active = current.binding.pending;
    if (!active || !sameSyncHead(active.head, head)) return rejected();
    const { pending: _pending, paused: _paused, ...verified } = confirmHead(current.binding, head);
    const stored = await chrome.storage.local.get<StoredSync>(ITEMS);
    const latest = withLocalAdditions(verified.state ?? emptyState, stored, current.deviceId);
    await chrome.storage.local.set({ [SYNC_META]: { ...current, binding: verified } });
    return await hashSyncState(latest) !== pending.baseVersion;
  });
}

async function publish(dav: WebdavClient, meta: BoundMeta, state: SyncState): Promise<boolean> {
  const { binding } = meta;
  const seq = meta.allocatedSeq + 1;
  if (!Number.isSafeInteger(seq)) return rejected();
  const intent = await createPublication({ deviceId: meta.deviceId, collectionId: binding.collectionId, seq }, state);
  const pending = asPublication(intent.head);
  const baseline = binding.confirmed?.head;
  const observed = await readIndex(dav, headName(meta.deviceId), binding.collectionId);
  if (!indexMatches(observed, baseline)) return safetyPause();
  await enqueue(async () => {
    const current = await requireCurrentBinding(binding);
    if (current.allocatedSeq !== meta.allocatedSeq) return rejected();
    await chrome.storage.local.set({ [SYNC_META]: { ...current, allocatedSeq: seq, binding: { ...current.binding, pending } } });
  });
  await dav.put([intent.head.snapshotName], intent.snapshotBytes, "application/gzip");
  return publishIndex(dav, binding, pending, baseline);
}

async function discoverIndexes(dav: WebdavClient, collectionId: string, seen: readonly SyncHead[], owner?: BoundMeta): Promise<readonly SyncHead[]> {
  const entries = await dav.list([], true).catch((error: unknown) => {
    if (error instanceof Error && /^(?:WEBDAV_LIST(?:_LIMIT)?|WEBDAV_DIRECTORY)$/.test(error.message)) return safetyPause();
    throw error;
  });
  if (!entries) return safetyPause();
  const names = entries.filter(entry => entry.name.startsWith("head-")).sort((left, right) => left.name < right.name ? -1 : 1);
  if (!names.length && (!owner?.binding.pending || owner.binding.joined || owner.binding.confirmed
    || !entries.every(entry => !entry.directory && isAllocatedSnapshot(entry.name, owner)))) return safetyPause();
  if (seen.some(head => !names.some(entry => entry.name === headName(head.deviceId)))) return safetyPause();
  const heads: SyncHead[] = [];
  for (const { name, directory } of names) {
    if (directory) return safetyPause();
    const head = await readIndex(dav, name, collectionId);
    if (!head) return safetyPause();
    const previous = seen.find(entry => entry.deviceId === head.deviceId);
    if (previous && (head.seq < previous.seq || (head.seq === previous.seq && !sameSyncHead(head, previous)))) return safetyPause();
    heads.push(head);
  }
  if (owner && !heads.some(head => head.deviceId === owner.deviceId)
    && await readIndex(dav, headName(owner.deviceId), collectionId)) return safetyPause();
  return heads;
}

async function readAdvertisedSnapshot(dav: WebdavClient, advertised: SyncHead): Promise<{ head: SyncHead; state: SyncState }> {
  const bytes = await dav.get([advertised.snapshotName]);
  if (bytes !== null) return { head: advertised, state: await verifySyncSnapshot(bytes, advertised).catch(safetyPause) };
  const newer = await readIndex(dav, headName(advertised.deviceId), advertised.collectionId);
  if (!newer || newer.seq <= advertised.seq) return safetyPause();
  const state = await readSnapshot(dav, newer);
  if (!state) return safetyPause();
  return { head: newer, state };
}

async function readDiscovered(dav: WebdavClient, indexes: readonly SyncHead[]): Promise<Discovered> {
  const heads: SyncHead[] = [];
  let state = emptyState;
  let clock = zeroClock;
  for (const index of indexes) {
    const { head, state: snapshot } = await readAdvertisedSnapshot(dav, index);
    heads.push(head);
    clock = stateClock(snapshot, clock);
    state = mergeSyncStates(state, snapshot);
  }
  return { heads, state, clock };
}

function isAllocatedSnapshot(name: string, { deviceId, allocatedSeq }: BoundMeta): boolean {
  const prefix = `snapshot-${deviceId}-`, suffix = ".json.gz";
  if (!name.startsWith(prefix) || !name.endsWith(suffix)) return false;
  const generation = name.slice(prefix.length, -suffix.length), seq = Number(generation);
  return Number.isSafeInteger(seq) && seq > 0 && seq <= allocatedSeq && String(seq) === generation;
}

function withLocalAdditions(state: SyncState, stored: CollectionState, deviceId: string): SyncState {
  const known = new Set(state.members.map(member => member.id));
  return mergeSyncStates(state, initialSyncState((stored[ITEMS] ?? []).filter(item => !known.has(item.id)), deviceId));
}

function mergeIntoCollection(stored: CollectionState, previous: SyncState, state: SyncState, deviceId: string) {
  const now = Date.now();
  const items = stored[ITEMS] ?? [];
  const incoming = receiveSyncText(items, previous, state, deviceId, now);
  return { added: incoming.added, removed: incoming.removed.size, patch: {
    ...(incoming.removed.size ? itemRemovalPatch(stored, incoming.items, incoming.removed)
      : incoming.added || incoming.items.some((item, index) => item !== items[index]) ? { [ITEMS]: incoming.items } : {}),
    ...(incoming.records.length ? { [OVERRIDE_LOG]: appendEditRecovery(incoming.records, readEditRecovery(stored, now)) } : {}) } };
}

async function evaluateJoin(message: Record<string, unknown>, meter: TransferMeter, confirm: boolean): Promise<SyncJoinPreview | undefined> {
  const endpoint = acceptanceEndpoint(message.endpoint), collectionId = message.collectionId;
  if (!isDeviceId(collectionId)) return rejected();
  const initial = await readMeta();
  if (initial?.binding) return rejected();
  const detached = initial?.detachedHeads?.collectionId === collectionId ? initial.detachedHeads : undefined;
  const dav = davFor(endpoint, meter);
  const indexes = await discoverIndexes(dav, collectionId, detached?.heads ?? []);
  const { heads, state, clock } = await readDiscovered(dav, indexes);
  return enqueue(async () => {
    const stored = await chrome.storage.local.get<StoredSync>([SYNC_META, ...KEYS, CURRENT, OVERRIDE_LOG]);
    const prior = stored[SYNC_META];
    if (prior?.binding || prior?.detachedId !== initial?.detachedId) return rejected();
    const items = stored[ITEMS] ?? [];
    const proofData = JSON.stringify([endpoint, collectionId, prior?.detachedId, heads, items.map(item => item.id)]);
    const proof = JSON.stringify(Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(proofData)))));
    const deviceId = prior?.deviceId ?? crypto.randomUUID();
    const previous = initialSyncState(items, deviceId, state);
    const merged = mergeSyncStates(previous, state);
    const incoming = mergeIntoCollection(stored, previous, merged, deviceId);
    if (!confirm) return { proof, collectionId, local: items.length - incoming.removed, incoming: incoming.added, removed: incoming.removed };
    if (message.proof !== proof) return rejected();
    if (items.length || stored.laterOnProjects?.length) await saveLocalRecovery(stored);
    const own = heads.find(head => head.deviceId === deviceId);
    const publishedSnapshots = detached?.endpoint === endpoint ? detached.publishedSnapshots : undefined;
    const binding: SyncBinding = { endpoint, collectionId, bindingId: crypto.randomUUID(), joined: true,
      state: merged, seen: heads, ...(publishedSnapshots ? { publishedSnapshots } : {}),
      ...(own ? { confirmed: asPublication(own) } : {}) };
    const next = { ...incoming.patch, [SYNC_META]: { deviceId, allocatedSeq: Math.max(prior?.allocatedSeq ?? 0, own?.seq ?? 0),
      clock: stateClock(previous, maxClock(clock, prior?.clock ?? zeroClock)), binding } };
    await commit(stored, next);
  });
}

async function prepareSync(binding: SyncBinding, remote: Discovered, own?: SyncHead): Promise<{ meta: BoundMeta; state: SyncState }> {
  return enqueue(async () => {
    const current = await requireCurrentBinding(binding);
    const stored = await chrome.storage.local.get<StoredSync>([...KEYS, CURRENT, OVERRIDE_LOG]);
    const previous = withLocalAdditions(current.binding.state ?? emptyState, stored, current.deviceId);
    const state = mergeSyncStates(previous, remote.state);
    const { pending, paused: _paused, ...rest } = own ? confirmHead(current.binding, own) : current.binding;
    const nextBinding: SyncBinding = { ...rest, seen: remote.heads, state,
      ...(pending && (!own || own.seq < pending.head.seq) ? { pending } : {}) };
    const meta = { ...current, allocatedSeq: Math.max(current.allocatedSeq, own?.seq ?? 0),
      clock: stateClock(previous, maxClock(remote.clock, current.clock ?? zeroClock)), binding: nextBinding };
    await commit(stored, { ...mergeIntoCollection(stored, previous, state, current.deviceId).patch, [SYNC_META]: meta });
    return { meta, state };
  });
}

async function canSkipSnapshots(binding: SyncBinding, indexes: readonly SyncHead[], seen: readonly SyncHead[]): Promise<boolean> {
  const confirmed = binding.confirmed;
  if (!confirmed || binding.pending || binding.paused || indexes.length !== seen.length
    || !indexes.every(head => seen.some(previous => sameSyncHead(head, previous)))) return false;
  return enqueue(async () => {
    const current = await requireCurrentBinding(binding);
    const stored = await chrome.storage.local.get<StoredSync>(ITEMS);
    const latest = withLocalAdditions(current.binding.state ?? emptyState, stored, current.deviceId);
    return await hashSyncState(latest) === confirmed.baseVersion;
  });
}

async function exchange(dav: WebdavClient, binding: SyncBinding, first: boolean): Promise<boolean> {
  if (first || (binding.paused && !binding.joined && !binding.confirmed && !binding.pending)) {
    if (binding.joined || binding.confirmed || binding.pending) return rejected();
    await requireEmpty(dav);
    const prepared = await enqueue(async () => {
      const current = await requireCurrentBinding(binding);
      const stored = await chrome.storage.local.get<StoredSync>(ITEMS);
      const state = withLocalAdditions(current.binding.state ?? emptyState, stored, current.deviceId);
      const next = { ...current, binding: { ...current.binding, state } };
      await commit(stored, { [SYNC_META]: next });
      return { current: next, state };
    });
    return publish(dav, prepared.current, prepared.state);
  }
  if (!binding.joined && !binding.confirmed && !binding.pending) return rejected();
  const current = await requireCurrentBinding(binding);
  const seen = verifiedHeads(binding);
  const indexes = await discoverIndexes(dav, binding.collectionId, seen, current);
  if (await canSkipSnapshots(binding, indexes, seen)) return false;
  const remote = await readDiscovered(dav, indexes);
  const own = remote.heads.find(head => head.deviceId === current.deviceId);
  const pending = binding.pending;
  const publishedPending = !!own && !!pending && own.seq === pending.head.seq;
  if (publishedPending && !sameSyncHead(own, pending.head)) return safetyPause();
  const prepared = await prepareSync(binding, remote, own);
  if (own && own.seq > (binding.confirmed?.head.seq ?? 0)) {
    const readback = await readIndex(dav, headName(current.deviceId), binding.collectionId);
    if (!indexMatches(readback, own)) return safetyPause();
  }
  const hash = await hashSyncState(prepared.state);
  if (publishedPending) return hash !== own.stateHash;
  const remaining = prepared.meta.binding.pending;
  if (remaining && hash === remaining.baseVersion && await readSnapshot(dav, remaining.head)) return publishIndex(dav, binding, remaining, own);
  if (!remaining && hash === own?.stateHash) return false;
  return publish(dav, prepared.meta, prepared.state);
}

async function cleanupSnapshots(dav: WebdavClient, binding: SyncBinding): Promise<void> {
  const { binding: current } = await requireCurrentBinding(binding);
  const head = current.confirmed?.head;
  if (!head || current.pending || current.paused) return;
  const older = (current.publishedSnapshots ?? []).filter(seq => seq < head.seq).sort((left, right) => right - left);
  for (const seq of older.slice(1)) {
    const advertised = await readIndex(dav, headName(head.deviceId), head.collectionId);
    if (!indexMatches(advertised, head)) return;
    await dav.remove([snapshotName({ deviceId: head.deviceId, seq })]);
    await enqueue(async () => {
      const meta = await requireCurrentBinding(binding);
      const publishedSnapshots = meta.binding.publishedSnapshots?.filter(known => known !== seq);
      await chrome.storage.local.set({ [SYNC_META]: { ...meta, binding: { ...meta.binding, publishedSnapshots } } });
    });
  }
}

async function syncCollection(binding: SyncBinding, meter: TransferMeter, first: boolean): Promise<boolean> {
  const dav = davFor(binding.endpoint, meter, binding);
  const moreChanges = await exchange(dav, binding, first);
  await cleanupSnapshots(dav, binding).catch(() => {});
  return moreChanges;
}

function status(binding?: SyncBinding): SyncAcceptanceStatus {
  if (!binding) return "unbound";
  return binding.paused ? "paused" : binding.pending ? "pending" : binding.confirmed ? "verified" : binding.joined ? "joined" : "ready";
}

export function registerSyncAcceptance(runTransfer: RunWebdavTransfer): void {
  if (!SYNC_ACCEPTANCE_BUILD) return;
  const running = new Set<string>();
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (!isRecord(message) || message.type !== SYNC_ACCEPTANCE_MESSAGE || !sender.url?.startsWith(chrome.runtime.getURL("settings.html"))) return;
    const run = async (): Promise<SyncAcceptanceReply> => {
      let preview: SyncJoinPreview | undefined;
      let moreChanges: boolean | undefined;
      if (message.action === "create") await runTransfer(meter => createLibrary(message.endpoint, meter));
      else if (message.action === "preview" || message.action === "join") {
        preview = await runTransfer(meter => evaluateJoin(message, meter, message.action === "join"));
      } else if (message.action === "unbind") {
        await enqueue(async () => chrome.storage.local.set(await detachSyncPatch({ preserveVerifiedHeads: true })));
      } else if (message.action === "publish" || message.action === "sync") {
        const binding = (await readMeta())?.binding;
        if (!binding || running.has(binding.bindingId)) return rejected();
        running.add(binding.bindingId);
        try { moreChanges = await runTransfer(meter => syncCollection(binding, meter, message.action === "publish")); }
        catch (error) {
          if (error instanceof Error && error.message === "SYNC_SAFETY_PAUSE") await pauseCurrentBinding(binding);
          throw error;
        }
        finally { running.delete(binding.bindingId); }
      }
      else if (message.action !== "status") return rejected();
      const binding = (await readMeta())?.binding;
      return { ok: true, status: status(binding), collectionId: binding?.collectionId, preview, moreChanges };
    };
    void run().then(respond, () => respond({ ok: false }));
    return true;
  });
}
