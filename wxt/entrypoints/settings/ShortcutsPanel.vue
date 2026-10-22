<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef } from "vue";
import { browser } from "wxt/browser";
import { t } from "../../../src/shared/i18n";
import { COMMANDS, formatDiagnostics } from "./shared";
import type { DiagnosticsSnapshot } from "./shared";
import type { SettingsDialog } from "./useDialog";

const props = defineProps<{ dialog: SettingsDialog }>();

const shortcuts = shallowRef<Readonly<Record<string, string>>>({});
const snapshot = shallowRef<DiagnosticsSnapshot>({});
const now = shallowRef(Date.now());
const diagnostics = computed(() => formatDiagnostics(snapshot.value, t, document.documentElement.lang, now.value));
let timer: ReturnType<typeof setInterval> | undefined;
let disposed = false;

function shortcutLabel(name: string, shortcut: string): string {
  const value = shortcuts.value[name];
  return value ? t("shortcutDefault", { shortcut: value, def: shortcut }) : t("shortcutNotSet", { def: shortcut });
}
async function refreshDiagnostics(): Promise<void> {
  snapshot.value = await browser.storage.local.get<DiagnosticsSnapshot>(["laterOnDiag", "laterOnPanelDiag", "laterOnLocateDiag"]);
  now.value = Date.now();
}
async function openShortcuts(): Promise<void> {
  try { await browser.tabs.create({ url: "chrome://extensions/shortcuts" }); }
  catch { await props.dialog.alert({ title: t("openShortcutsFailTitle"), message: t("openShortcutsFailMsg") }); }
}
async function init(): Promise<void> {
  try {
    const commands = await browser.commands.getAll();
    shortcuts.value = Object.fromEntries(commands.map(command => [command.name ?? "", command.shortcut ?? ""]));
  } catch { /* Missing command information uses the localized default shortcut text. */ }
  await refreshDiagnostics().catch(() => {});
  if (disposed) return;
  timer = setInterval(() => { void refreshDiagnostics().catch(() => {}); }, 2000);
}

onMounted(init);
onUnmounted(() => { disposed = true; clearInterval(timer); });
</script>

<template>
  <section class="settings-group">
    <h2>{{ t('shortcuts') }}</h2>
    <p class="setting-note">{{ t('shortcutsNote') }}</p>
    <div v-for="command in COMMANDS" :key="command.name" class="setting-row">
      <div class="setting-label"><strong>{{ t(command.label) }}</strong><span :id="command.id">{{ shortcutLabel(command.name, command.shortcut) }}</span></div>
    </div>
    <div class="setting-row"><div class="setting-label"><strong>{{ t('inLibrary') }}</strong><span>{{ t('searchFocusHint') }}</span></div></div>
    <div class="setting-row"><button id="openShortcuts" class="setting-action" type="button" @click="openShortcuts">{{ t('manageShortcuts') }}</button></div>
    <details class="settings-diagnostics">
      <summary>{{ t('diagSummary') }}</summary>
      <div v-for="row in diagnostics" :key="row.id" class="setting-row">
        <div class="setting-label"><strong>{{ t(row.label) }}</strong><span :id="row.id">{{ row.text }}</span></div>
      </div>
      <p class="setting-note" id="diagHint">{{ t('diagHint') }}</p>
    </details>
  </section>
</template>
