<script setup lang="ts">
import { onMounted, ref } from "vue";
import { t } from "../../../src/shared/i18n";
import { SYNC_ACCEPTANCE_MESSAGE } from "../../../src/sync/acceptance";
import type { SyncAcceptanceAction, SyncAcceptanceReply, SyncAcceptanceStatus } from "../../../src/sync/acceptance";

const labels = { ready: "syncAcceptanceReady", pending: "syncAcceptancePending", verified: "syncAcceptanceVerified" } as const;
const endpoint = ref("");
const busy = ref(false);
const failed = ref(false);
const status = ref<SyncAcceptanceStatus>("unbound");

async function send(action: SyncAcceptanceAction): Promise<SyncAcceptanceReply> {
  return chrome.runtime.sendMessage({ type: SYNC_ACCEPTANCE_MESSAGE, action,
    ...(action === "create" ? { endpoint: endpoint.value } : {}) }).catch(() => ({ ok: false }));
}

async function run(action: SyncAcceptanceAction): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  failed.value = false;
  try {
    const result = await send(action);
    failed.value = !result.ok;
    const current = result.ok || action === "status" ? result : await send("status");
    if (current.ok) status.value = current.status;
  } finally { busy.value = false; }
}

function create(): Promise<void> { return run("create"); }
function publish(): Promise<void> { return run("publish"); }

onMounted(() => { void run("status"); });
</script>

<template>
  <section class="settings-group" aria-labelledby="sync-acceptance-heading" :aria-busy="busy">
    <h2 id="sync-acceptance-heading">{{ t('syncAcceptanceTitle') }}</h2>
    <p class="setting-note">{{ t('syncAcceptanceHint') }}</p>
    <form v-if="status === 'unbound'" @submit.prevent="create">
      <label class="sync-acceptance-field">
        <span>{{ t('syncAcceptanceEndpoint') }}</span>
        <input v-model="endpoint" class="setting-select" type="url" required :disabled="busy" spellcheck="false" />
      </label>
      <button class="setting-action" type="submit" :disabled="busy">{{ t('syncAcceptanceCreate') }}</button>
    </form>
    <template v-else>
      <p class="setting-note" role="status">{{ t(labels[status]) }}</p>
      <button v-if="status !== 'verified'" class="setting-action" type="button" :disabled="busy || status !== 'ready'" @click="publish">
        {{ t('syncAcceptancePublish') }}
      </button>
    </template>
    <p v-if="failed" class="setting-note" role="alert">{{ t('syncAcceptanceFailed') }}</p>
  </section>
</template>

<style scoped>
.sync-acceptance-field { display: grid; gap: 0.5rem; margin-block-end: 0.75rem; }
.sync-acceptance-field input { min-width: 0; }
</style>
