<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { SwitchRoot, SwitchThumb } from "reka-ui";
import { browser } from "wxt/browser";
import { t } from "../../../src/shared/i18n";
import type { Browser } from "wxt/browser";

const enabled = ref(false);
const loaded = ref(false);
const busy = ref(false);
const error = ref<"load" | "denied" | "change" | null>(null);
const permission: Browser.permissions.Permissions = { permissions: ["notifications"] };
let alive = true, generation = 0;

async function refresh(): Promise<void> {
  const token = ++generation;
  try {
    const granted = await browser.permissions.contains(permission);
    if (!alive || token !== generation) return;
    enabled.value = granted;
    loaded.value = true;
    if (error.value === "load" || (granted && error.value === "denied")) error.value = null;
  } catch {
    if (!alive || token !== generation) return;
    loaded.value = false;
    error.value = "load";
  }
}
async function change(value: boolean): Promise<void> {
  if (!loaded.value || busy.value || value === enabled.value) return;
  busy.value = true;
  error.value = null;
  generation += 1;
  try {
    // Request before any await so the browser retains the user's click gesture.
    const accepted = await (value ? browser.permissions.request(permission) : browser.permissions.remove(permission));
    if (!alive) return;
    if (!accepted) error.value = value ? "denied" : "change";
  } catch {
    if (alive) error.value = "change";
  } finally {
    if (alive) {
      await refresh();
      busy.value = false;
    }
  }
}
function refreshWhenIdle(): void { if (!busy.value) void refresh(); }
function permissionsChanged(change: { readonly permissions?: readonly string[] }): void {
  if (!change.permissions?.includes("notifications")) return;
  error.value = null;
  void refresh();
}

onMounted(() => {
  browser.permissions.onAdded.addListener(permissionsChanged);
  browser.permissions.onRemoved.addListener(permissionsChanged);
  window.addEventListener("focus", refreshWhenIdle);
  void refresh();
});
onUnmounted(() => {
  alive = false;
  generation += 1;
  browser.permissions.onAdded.removeListener(permissionsChanged);
  browser.permissions.onRemoved.removeListener(permissionsChanged);
  window.removeEventListener("focus", refreshWhenIdle);
});
</script>

<template>
  <div class="setting-row">
    <div class="setting-label">
      <strong id="notificationsLabel">{{ t('saveNotifications') }}</strong>
      <span id="notificationsHint">{{ t('saveNotificationsHint') }}</span>
      <span v-if="error" id="notificationsError" role="alert">{{ t(error === 'load' ? 'notificationsLoadFailed' : error === 'denied' ? 'notificationsDenied' : 'notificationsChangeFailed') }}</span>
      <button v-if="error === 'load'" class="setting-action" type="button" @click="refresh">{{ t('retry') }}</button>
    </div>
    <SwitchRoot class="switch" data-setting="saveNotifications" aria-labelledby="notificationsLabel" :aria-describedby="error ? 'notificationsHint notificationsError' : 'notificationsHint'" :aria-busy="busy" :model-value="enabled" :disabled="!loaded || busy" @update:model-value="change"><SwitchThumb class="slider" /></SwitchRoot>
  </div>
</template>
