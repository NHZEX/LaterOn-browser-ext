<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef } from "vue";
import { t } from "../../../src/shared/i18n";
import { SYNC_ACCEPTANCE_MESSAGE, SYNC_META } from "../../../src/sync/acceptance";
import type { SyncAcceptanceAction, SyncAcceptanceReply, SyncAcceptanceStatus, SyncJoinPreview } from "../../../src/sync/acceptance";

const labels = { ready: "syncAcceptanceReady", pending: "syncAcceptancePending", joined: "syncAcceptanceJoined",
  verified: "syncAcceptanceVerified", paused: "syncAcceptancePaused" } as const;
const endpoint = ref("");
const joinEndpoint = ref("");
const expectedId = ref("");
const collectionId = ref("");
const synced = ref(false);
const moreChanges = ref(false);
const busy = ref(false);
const failed = ref(false);
const status = ref<SyncAcceptanceStatus>("unbound");
const preview = shallowRef<SyncJoinPreview>();

async function send(action: SyncAcceptanceAction): Promise<SyncAcceptanceReply> {
  return chrome.runtime.sendMessage({ type: SYNC_ACCEPTANCE_MESSAGE, action,
    ...(action === "create" ? { endpoint: endpoint.value } : {}),
    ...(action === "preview" || action === "join" ? { endpoint: joinEndpoint.value,
      collectionId: expectedId.value.trim(), proof: preview.value?.proof } : {}) }).catch(() => ({ ok: false }));
}

async function run(action: SyncAcceptanceAction): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  failed.value = false;
  synced.value = false;
  moreChanges.value = false;
  try {
    const result = await send(action);
    failed.value = !result.ok;
    preview.value = result.ok ? result.preview : undefined;
    synced.value = result.ok && action === "sync";
    moreChanges.value = result.ok && result.moreChanges === true;
    const current = result.ok || action === "status" ? result : await send("status");
    if (current.ok) { status.value = current.status; collectionId.value = current.collectionId ?? ""; }
  } finally { busy.value = false; }
}

function create(): Promise<void> { return run("create"); }
function publish(): Promise<void> { return run("publish"); }
function previewJoin(): Promise<void> { return run("preview"); }
function confirmJoin(): Promise<void> { return run("join"); }
function cancelJoin(): void { preview.value = undefined; }
function sync(): Promise<void> { return run("sync"); }
function unbind(): Promise<void> { return run("unbind"); }

const refresh: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
  if (area === "local" && changes[SYNC_META] && !busy.value) void run("status");
};

onMounted(() => { chrome.storage.onChanged.addListener(refresh); void run("status"); });
onUnmounted(() => { chrome.storage.onChanged.removeListener(refresh); });
</script>

<template>
  <section class="settings-group" aria-labelledby="sync-acceptance-heading" :aria-busy="busy">
    <h2 id="sync-acceptance-heading">{{ t('syncAcceptanceTitle') }}</h2>
    <p class="setting-note">{{ t('syncAcceptanceHint') }}</p>
    <form v-if="status === 'unbound' && !preview" @submit.prevent="create">
      <label class="sync-acceptance-field">
        <span>{{ t('syncAcceptanceEndpoint') }}</span>
        <input v-model="endpoint" class="setting-select" type="url" required :disabled="busy" spellcheck="false" />
      </label>
      <button class="setting-action" type="submit" :disabled="busy">{{ t('syncAcceptanceCreate') }}</button>
    </form>
    <form v-if="status === 'unbound' && !preview" @submit.prevent="previewJoin">
      <label class="sync-acceptance-field">
        <span>{{ t('syncAcceptanceJoinEndpoint') }}</span>
        <input v-model="joinEndpoint" class="setting-select" type="url" required :disabled="busy" spellcheck="false" />
      </label>
      <label class="sync-acceptance-field">
        <span>{{ t('syncAcceptanceExpectedId') }}</span>
        <input v-model="expectedId" class="setting-select" type="text" required :disabled="busy" spellcheck="false" />
      </label>
      <button class="setting-action" type="submit" :disabled="busy">{{ t('syncAcceptancePreview') }}</button>
    </form>
    <template v-if="preview">
      <p class="setting-note">{{ t('syncAcceptanceJoinSummary', { collectionId: preview.collectionId, local: preview.local, incoming: preview.incoming, removed: preview.removed }) }}</p>
      <button class="setting-action" type="button" :disabled="busy" @click="confirmJoin">{{ t('syncAcceptanceJoin') }}</button>
      <button class="setting-action" type="button" :disabled="busy" @click="cancelJoin">{{ t('syncAcceptanceCancel') }}</button>
    </template>
    <template v-if="status !== 'unbound'">
      <p class="setting-note">{{ t('syncAcceptanceIdentity', { id: collectionId }) }}</p>
      <p class="setting-note" role="status">{{ t(busy ? 'syncAcceptanceWorking' : moreChanges ? 'syncAcceptanceMoreChanges' : synced ? 'syncAcceptanceSynced' : labels[status]) }}</p>
      <button v-if="status === 'ready'" class="setting-action" type="button" :disabled="busy" @click="publish">
        {{ t('syncAcceptancePublish') }}
      </button>
      <button v-if="status === 'joined' || status === 'verified'" class="setting-action" type="button" :disabled="busy" @click="sync">{{ t('syncAcceptanceSync') }}</button>
      <button v-if="status === 'pending' || status === 'paused'" class="setting-action" type="button" :disabled="busy" @click="sync">
        {{ t(status === 'pending' ? 'syncAcceptanceRetryPublication' : 'syncAcceptanceRetrySync') }}
      </button>
      <button class="setting-action" type="button" :disabled="busy" @click="unbind">{{ t('syncAcceptanceUnbind') }}</button>
    </template>
    <p v-if="failed" class="setting-note" role="alert">{{ t('syncAcceptanceFailed') }}</p>
  </section>
</template>

<style scoped>
.sync-acceptance-field { display: grid; gap: 0.5rem; margin-block-end: 0.75rem; }
.sync-acceptance-field input { min-width: 0; }
</style>
