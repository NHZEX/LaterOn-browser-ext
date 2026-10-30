<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef } from "vue";
import { browser } from "wxt/browser";
import { t } from "../../../src/shared/i18n";
import { calculateStorageUsage, formatStorageBytes } from "./shared";
import type { StorageUsage } from "./shared";

const usage = shallowRef<StorageUsage | null>(null);
const loading = ref(false);
const failed = ref(false);
const stale = ref(false);
const categories = [
  { key: "metadataBytes", label: "storageMetadata" },
  { key: "iconBytes", label: "storageIcons" },
  { key: "coverBytes", label: "storageCovers" },
  { key: "otherBytes", label: "storageOther" }
] as const;
let revision = 0;
let disposed = false;

function formatBytes(bytes: number): string { return formatStorageBytes(bytes, document.documentElement.lang || "zh-CN"); }
function changed(_changes: unknown, area: string): void {
  if (area !== "local") return;
  revision += 1;
  stale.value = true;
}
async function refresh(): Promise<void> {
  if (loading.value || disposed) return;
  loading.value = true;
  failed.value = false;
  const started = revision;
  try {
    const [snapshot, totalBytes] = await Promise.all([
      browser.storage.local.get(null), browser.storage.local.getBytesInUse(null)
    ]);
    if (disposed) return;
    usage.value = calculateStorageUsage(snapshot, totalBytes);
    stale.value = started !== revision;
  } catch {
    if (!disposed) { failed.value = true; stale.value = true; }
  } finally {
    if (!disposed) loading.value = false;
  }
}

onMounted(() => {
  browser.storage.onChanged.addListener(changed);
  void refresh();
});
onUnmounted(() => {
  disposed = true;
  browser.storage.onChanged.removeListener(changed);
});
</script>

<template>
  <section class="settings-group storage-usage" aria-labelledby="storageUsageTitle" :aria-busy="loading">
    <h2 id="storageUsageTitle">{{ t('storageUsage') }}</h2>
    <div class="storage-summary">
      <div>
        <template v-if="usage">
          <p class="storage-total"><span>{{ t('storageUsed') }}</span><strong>{{ formatBytes(usage.totalBytes) }}</strong></p>
          <p class="setting-note">{{ t('storageCounts', { items: usage.itemCount, projects: usage.projectCount }) }}</p>
        </template>
        <p v-else-if="loading" role="status">{{ t('loading') }}</p>
      </div>
      <button class="setting-action" type="button" :disabled="loading" @click="refresh">{{ t(loading ? 'storageRefreshing' : failed ? 'retry' : 'storageRefresh') }}</button>
    </div>
    <p v-if="failed" class="storage-error setting-note" role="alert">{{ t(usage ? 'storageRefreshFailed' : 'storageLoadFailed') }}</p>
    <p v-else-if="stale && !loading" class="setting-note" role="status">{{ t('storageStale') }}</p>
    <template v-if="usage">
      <dl class="storage-breakdown">
        <div v-for="category in categories" :key="category.key"><dt>{{ t(category.label) }}</dt><dd>{{ formatBytes(usage[category.key]) }}</dd></div>
      </dl>
      <p class="setting-note">{{ t('storageImageCounts', { inline: usage.inlineIconCount, remote: usage.remoteIconCount, covers: usage.inlineCoverCount }) }}</p>
      <p class="setting-note">{{ t('storageStoredIcons', { n: usage.storedIconCount }) }}</p>
    </template>
    <p class="setting-note">{{ t('storageUsageHint') }}</p>
  </section>
</template>
