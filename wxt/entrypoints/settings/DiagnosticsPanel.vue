<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef } from "vue";
import { browser } from "wxt/browser";
import { t } from "../../../src/shared/i18n";
import { formatDiagnostics } from "./shared";
import type { DiagnosticsSnapshot } from "./shared";

const expanded = ref(false);
const failed = ref(false);
const loading = ref(false);
const snapshot = shallowRef<DiagnosticsSnapshot>({});
const now = ref(Date.now());
const diagnostics = computed(() => formatDiagnostics(snapshot.value, t, document.documentElement.lang, now.value));
let timer: ReturnType<typeof setInterval> | undefined;
let revision = 0;

function stop(): void {
  clearInterval(timer);
  revision += 1;
  snapshot.value = {};
  loading.value = false;
  failed.value = false;
}
async function refresh(): Promise<void> {
  if (!expanded.value || loading.value) return;
  const request = revision;
  loading.value = true;
  try {
    const result = await browser.storage.local.get<DiagnosticsSnapshot>(["laterOnDiag", "laterOnPanelDiag", "laterOnLocateDiag"]);
    if (request !== revision) return;
    snapshot.value = result;
    now.value = Date.now();
    failed.value = false;
  } catch {
    if (request === revision) failed.value = true;
  } finally {
    if (request === revision) loading.value = false;
  }
}
function toggle(event: Event): void {
  if (!(event.currentTarget instanceof HTMLDetailsElement)) return;
  expanded.value = event.currentTarget.open;
  stop();
  if (!expanded.value) return;
  void refresh();
  timer = setInterval(() => { void refresh(); }, 2000);
}

onUnmounted(stop);
</script>

<template>
  <section class="settings-group">
    <h2>{{ t('diagnosticsTitle') }}</h2>
    <details class="settings-diagnostics" @toggle="toggle">
      <summary>{{ t('diagSummary') }}</summary>
      <div v-if="expanded">
        <div v-if="failed" class="setting-note" role="alert">
          <p>{{ t('diagnosticsFailed') }}</p>
          <button class="setting-action" type="button" :disabled="loading" @click="refresh">{{ t('retry') }}</button>
        </div>
        <div v-for="row in diagnostics" :key="row.id" class="setting-row">
          <div class="setting-label"><strong>{{ t(row.label) }}</strong><span :id="row.id">{{ row.text }}</span></div>
        </div>
        <p class="setting-note" id="diagHint">{{ t('diagHint') }}</p>
      </div>
    </details>
  </section>
</template>
