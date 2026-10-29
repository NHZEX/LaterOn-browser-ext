<script setup lang="ts">
import { onMounted, ref, shallowRef } from "vue";
import { SwitchRoot, SwitchThumb } from "reka-ui";
import { browser } from "wxt/browser";
import * as settings from "../../../src/settings/store";
import { setLanguage, t } from "../../../src/shared/i18n";
import { clampDays } from "./shared";
import { useDialog } from "./useDialog";
import BackupPanel from "./BackupPanel.vue";
import StorageUsagePanel from "./StorageUsagePanel.vue";
import ShortcutsPanel from "./ShortcutsPanel.vue";
import SettingsDialog from "./SettingsDialog.vue";
import type { Settings, StoredSettings } from "../../../src/settings/shared";

const dialog = useDialog();
const current = shallowRef<Settings | null>(null);
const saving = ref(false);
const confirmingAutoClean = ref(false);
const loadError = ref(false);
// This page is still copied as a legacy public asset rather than a WXT entry.
const libraryUrl = new URL("library.html", window.location.href).href;
const iconUrl = "/icon128.png";
const languages = [{ value: "zh-CN", label: "chinese" }, { value: "en", label: "english" }] as const;
const themes = [{ value: "light", label: "light" }, { value: "dark", label: "dark" }, { value: "system", label: "system" }] as const;
const sortOptions = [{ value: "newest", label: "sortNewest" }, { value: "oldest", label: "sortOldest" }, { value: "source", label: "sortSource" }, { value: "custom", label: "sortCustomDragged" }] as const;

async function save(patch: StoredSettings): Promise<void> {
  if (!current.value || saving.value) return;
  saving.value = true;
  try {
    await settings.set(patch);
    current.value = { ...current.value, ...patch };
    if (patch.language) await setLanguage(patch.language);
  } catch {
    await dialog.alert({ tone: "danger", title: t("operationFailed"), message: t("backupOperationFailed") });
  } finally { saving.value = false; }
}
function changeSort(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  const option = sortOptions.find(option => option.value === target.value);
  if (option) void save({ defaultSort: option.value });
}
function changeDays(event: Event): void {
  if (!current.value?.autoCleanEnabled) return;
  if (!(event.target instanceof HTMLInputElement)) return;
  const days = clampDays(event.target.value);
  event.target.value = String(days);
  void save({ autoCleanDays: days });
}
function changeSingle(value: boolean): void { void save({ askFolderOnSingle: value }); }
function changeBatch(value: boolean): void { void save({ askFolderOnBatch: value }); }
async function changeAutoClean(value: boolean): Promise<void> {
  if (!current.value || saving.value || confirmingAutoClean.value || value === current.value.autoCleanEnabled) return;
  if (!value) { await save({ autoCleanEnabled: false }); return; }
  confirmingAutoClean.value = true;
  try {
    const confirmed = await dialog.confirm({
      tone: "danger",
      title: t("autoCleanConfirmTitle"),
      message: t("autoCleanConfirmMessage", { days: clampDays(current.value.autoCleanDays) }),
      confirmText: t("autoCleanConfirmButton")
    });
    if (confirmed) await save({ autoCleanEnabled: true });
  } finally { confirmingAutoClean.value = false; }
}

async function navigate(url: string): Promise<void> {
  const tab = await browser.tabs.getCurrent().catch(() => undefined);
  if (tab?.id) await browser.tabs.update(tab.id, { url });
  else window.location.href = url;
}
function replayOnboarding(): Promise<void> { return navigate(`${libraryUrl}?guide=1`); }
function back(event: MouseEvent): void {
  event.preventDefault();
  const goToLibrary = (): void => { window.location.href = libraryUrl; };
  if (window.history.length > 1) {
    window.history.back();
    window.setTimeout(goToLibrary, 300);
  } else goToLibrary();
}
async function home(event: MouseEvent): Promise<void> {
  event.preventDefault();
  if (event.metaKey || event.ctrlKey || event.shiftKey) {
    await browser.tabs.create({ url: libraryUrl });
    return;
  }
  try { await browser.storage.local.set({ laterOnActiveProject: "all" }); }
  catch { /* Navigation still works if restoring the default project fails. */ }
  await navigate(libraryUrl);
}
async function init(): Promise<void> {
  loadError.value = false;
  document.title = `StaySide · ${t("settings")}`;
  try { current.value = await settings.get(); }
  catch { loadError.value = true; }
}

onMounted(init);
</script>

<template>
  <header class="settings-top">
    <a id="settingsHome" class="settings-brand" href="library.html" :aria-label="t('home')" :title="t('home')" @click="home"><img class="logo" :src="iconUrl" width="40" height="40" alt="" /><span class="brand-name">StaySide</span></a>
    <a id="back" class="settings-back" href="library.html" @click="back">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m0 0 6-6m-6 6 6 6" /></svg><span>{{ t('back') }}</span>
    </a>
  </header>
  <div class="settings-shell">
    <main class="settings-main">
      <div class="settings-title"><h1>{{ t('settings') }}</h1><p>{{ t('titleSettings') }}</p></div>
      <template v-if="current">
        <section class="settings-group">
          <h2>{{ t('appearance') }}</h2>
          <div class="setting-row">
            <div class="setting-label"><strong id="languageLabel">{{ t('language') }}</strong><span>{{ t('languageHint') }}</span></div>
            <div class="segmented" data-setting="language" role="group" aria-labelledby="languageLabel">
              <button v-for="language in languages" :key="language.value" type="button" :data-value="language.value" :class="{ active: current.language === language.value }" :aria-pressed="current.language === language.value" :disabled="saving" @click="save({ language: language.value })">{{ t(language.label) }}</button>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-label"><strong id="themeLabel">{{ t('theme') }}</strong><span>{{ t('themeHint') }}</span></div>
            <div class="segmented" data-setting="theme" role="group" aria-labelledby="themeLabel">
              <button v-for="theme in themes" :key="theme.value" type="button" :data-value="theme.value" :class="{ active: current.theme === theme.value }" :aria-pressed="current.theme === theme.value" :disabled="saving" @click="save({ theme: theme.value })">{{ t(theme.label) }}</button>
            </div>
          </div>
        </section>
        <section class="settings-group">
          <h2>{{ t('guideSettingsTitle') }}</h2>
          <div class="setting-row"><div class="setting-label"><strong>{{ t('guideReplayTitle') }}</strong><span>{{ t('guideReplayHint') }}</span></div><button id="replayOnboarding" class="setting-action" type="button" @click="replayOnboarding">{{ t('guideReplayButton') }}</button></div>
        </section>
        <section class="settings-group">
          <h2>{{ t('collection') }}</h2>
          <div class="setting-row">
            <div class="setting-label"><strong id="sortLabel">{{ t('defaultSort') }}</strong><span>{{ t('defaultSortHint') }}</span></div>
            <select class="setting-select" data-setting="defaultSort" aria-labelledby="sortLabel" :value="current.defaultSort" :disabled="saving" @change="changeSort"><option v-for="option in sortOptions" :key="option.value" :value="option.value">{{ t(option.label) }}</option></select>
          </div>
          <div class="setting-row">
            <div class="setting-label"><strong id="singleLabel">{{ t('askSingle') }}</strong><span id="singleHint">{{ t('askSingleHint') }}</span></div>
            <SwitchRoot class="switch" data-setting="askFolderOnSingle" aria-labelledby="singleLabel" aria-describedby="singleHint" :model-value="current.askFolderOnSingle" :disabled="saving" @update:model-value="changeSingle"><SwitchThumb class="slider" /></SwitchRoot>
          </div>
          <div class="setting-row">
            <div class="setting-label"><strong id="batchLabel">{{ t('askBatch') }}</strong><span id="batchHint">{{ t('askBatchHint') }}</span></div>
            <SwitchRoot class="switch" data-setting="askFolderOnBatch" aria-labelledby="batchLabel" aria-describedby="batchHint" :model-value="current.askFolderOnBatch" :disabled="saving" @update:model-value="changeBatch"><SwitchThumb class="slider" /></SwitchRoot>
          </div>
          <div class="setting-row">
            <div class="setting-label"><strong id="cleanLabel">{{ t('autoClean') }}</strong><span id="cleanPolicyHint">{{ t('autoCleanPolicyHint') }}</span></div>
            <SwitchRoot class="switch" data-setting="autoCleanEnabled" aria-labelledby="cleanLabel" aria-describedby="cleanPolicyHint cleanResumeHint" :model-value="current.autoCleanEnabled" :disabled="saving || confirmingAutoClean" @update:model-value="changeAutoClean"><SwitchThumb class="slider" /></SwitchRoot>
          </div>
          <div class="setting-row">
            <div class="setting-label"><strong>{{ t('autoCleanDaysLabel') }}</strong><span id="cleanHint">{{ t('autoCleanHint') }}</span></div>
            <div class="setting-days"><input class="setting-number" type="number" min="30" max="180" step="1" data-setting="autoCleanDays" :value="clampDays(current.autoCleanDays)" :aria-label="t('autoCleanDaysLabel')" aria-describedby="cleanHint cleanResumeHint" :disabled="saving || !current.autoCleanEnabled" @change="changeDays" /><span>{{ t('unitDays') }}</span></div>
          </div>
          <p id="cleanResumeHint" class="setting-note">{{ t('autoCleanResumeHint') }}</p>
        </section>
        <ShortcutsPanel :dialog="dialog" />
        <StorageUsagePanel />
        <BackupPanel :dialog="dialog" />
      </template>
      <div v-else-if="loadError" role="alert"><p>{{ t('settingsLoadFailed') }}</p><button id="retrySettings" class="setting-action" type="button" @click="init">{{ t('retry') }}</button></div>
      <p v-else role="status">{{ t('loading') }}</p>
    </main>
  </div>
  <SettingsDialog :request="dialog.state.value" @resolve="dialog.finish" />
</template>
