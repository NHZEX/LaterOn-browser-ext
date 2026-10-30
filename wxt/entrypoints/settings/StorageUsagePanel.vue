<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from "vue";
import { browser } from "wxt/browser";
import { t } from "../../../src/shared/i18n";
import { ITEMS, ICONS } from "../../../src/storage/contracts";
import { calculateStorageUsage, createStorageIconIndex, formatStorageBytes, storageIconPage, STORAGE_ICON_PAGE_SIZE } from "./shared";
import type { StorageUsage, StorageIconIndex } from "./shared";

const usage = shallowRef<StorageUsage | null>(null);
const loading = ref(false);
const failed = ref(false);
const stale = ref(false);
const expanded = ref(false);
const failedIcons = shallowRef<ReadonlySet<string>>(new Set());
const iconIndex = shallowRef<StorageIconIndex | null>(null);
const iconLoading = ref(false);
const iconLoadFailed = ref(false);
const iconPage = ref(0);
const iconList = ref<HTMLUListElement | null>(null);
const pageIcons = computed(() => storageIconPage(iconIndex.value ?? [], iconPage.value));
const iconPages = computed(() => Math.max(1, Math.ceil((iconIndex.value?.length ?? 0) / STORAGE_ICON_PAGE_SIZE)));
const categories = [
  { key: "metadataBytes", label: "storageMetadata" },
  { key: "iconBytes", label: "storageIcons" },
  { key: "coverBytes", label: "storageCovers" },
  { key: "otherBytes", label: "storageOther" }
] as const;
let revision = 0;
let disposed = false;
let iconRequest = 0;

function formatBytes(bytes: number): string { return formatStorageBytes(bytes, document.documentElement.lang || "zh-CN"); }
function toggleDetails(event: Event): void {
  if (!(event.currentTarget instanceof HTMLDetailsElement)) return;
  expanded.value = event.currentTarget.open;
  if (expanded.value) void loadIcons();
  else clearIcons();
}
function iconFailed(key: string): void { failedIcons.value = new Set([...failedIcons.value, key]); }
function clearIcons(): void {
  iconRequest += 1;
  iconIndex.value = null;
  iconLoading.value = false;
  iconLoadFailed.value = false;
  iconPage.value = 0;
  failedIcons.value = new Set();
}
function changeIconPage(delta: number): void {
  iconPage.value = Math.max(0, Math.min(iconPage.value + delta, iconPages.value - 1));
  failedIcons.value = new Set();
  if (iconList.value) iconList.value.scrollTop = 0;
}
async function loadIcons(): Promise<void> {
  if (disposed || !expanded.value) return;
  const request = ++iconRequest;
  iconLoading.value = true;
  iconLoadFailed.value = false;
  try {
    const snapshot = await browser.storage.local.get([ITEMS, ICONS]);
    if (disposed || !expanded.value || request !== iconRequest) return;
    iconIndex.value = createStorageIconIndex(snapshot);
    iconPage.value = 0;
    failedIcons.value = new Set();
  } catch {
    if (!disposed && expanded.value && request === iconRequest) iconLoadFailed.value = true;
  } finally {
    if (request === iconRequest) iconLoading.value = false;
  }
}
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
    if (expanded.value) void loadIcons();
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
  clearIcons();
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
      <p class="storage-icon-summary setting-note">{{ t('storageIconSummary', { uses: usage.inlineIconCount, stored: usage.storedIconCount }) }}</p>
      <p v-if="usage.missingIconCount" class="storage-error setting-note">{{ t('storageMissingIcons', { n: usage.missingIconCount }) }}</p>
      <details class="storage-details" @toggle="toggleDetails">
        <summary>{{ t('storageIconDetails') }}</summary>
        <div v-if="expanded" :aria-busy="iconLoading">
          <p v-if="iconLoading" class="setting-note" role="status">{{ t('loading') }}</p>
          <div v-else-if="iconLoadFailed" class="storage-icon-error">
            <p class="storage-error setting-note" role="alert">{{ t('storageIconLoadFailed') }}</p>
            <button class="setting-action" type="button" @click="loadIcons">{{ t('retry') }}</button>
          </div>
          <template v-else-if="iconIndex">
            <ul v-if="iconIndex.length" ref="iconList" class="storage-icon-list" :aria-label="t('storageIconDetails')">
              <li v-for="icon in pageIcons" :key="icon.key">
                <span class="storage-icon-preview" aria-hidden="true">
                  <img v-if="!failedIcons.has(icon.key)" :src="icon.source" alt="" width="24" height="24" loading="lazy" @error="iconFailed(icon.key)">
                  <span v-else>—</span>
                </span>
                <span class="storage-icon-info">
                  <strong>{{ icon.sites.join(' · ') || t('storageIconUnnamed') }}</strong>
                  <span>{{ t(icon.shared ? 'storageIconReferences' : 'storageIconStandalone', { n: icon.references }) }}<template v-if="failedIcons.has(icon.key)"> · {{ t('storageIconPreviewFailed') }}</template></span>
                </span>
                <span class="storage-icon-bytes">{{ formatBytes(icon.bytes) }}</span>
              </li>
            </ul>
            <p v-else class="setting-note">{{ t('storageNoIcons') }}</p>
            <nav v-if="iconPages > 1" class="storage-icon-pagination" :aria-label="t('storageIconPagination')">
              <button class="setting-action" type="button" :disabled="iconPage === 0" @click="changeIconPage(-1)">{{ t('storageIconPrevious') }}</button>
              <span aria-live="polite">{{ t('storageIconPage', { page: iconPage + 1, pages: iconPages }) }}</span>
              <button class="setting-action" type="button" :disabled="iconPage + 1 === iconPages" @click="changeIconPage(1)">{{ t('storageIconNext') }}</button>
            </nav>
          </template>
          <p class="setting-note">{{ t('storageImageCounts', { remote: usage.remoteIconCount, covers: usage.inlineCoverCount }) }}</p>
          <p class="setting-note">{{ t('storageUsageHint') }}</p>
        </div>
      </details>
    </template>
  </section>
</template>
