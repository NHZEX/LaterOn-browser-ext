<script setup lang="ts">
import { clearPanelCache, wipeCollection } from "../../../src/backup/client";
import { t } from "../../../src/shared/i18n";
import { backupErrorKey } from "./shared";
import type { SettingsDialog } from "./useDialog";

const props = defineProps<{ dialog: SettingsDialog }>();
const busy = defineModel<boolean>("busy", { default: false });

async function wipe(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    if (!await props.dialog.confirm({ tone: "danger", title: t("wipeConfirmTitle"), message: t("wipeConfirmMsg"), confirmText: t("wipeConfirmBtn") })) return;
    await wipeCollection();
    clearPanelCache();
    await props.dialog.alert({ tone: "success", title: t("wipeDoneTitle"), message: t("wipeDoneMsg") });
  } catch (error) {
    await props.dialog.alert({ tone: "danger", title: t("backupOperationFailed"), message: t(backupErrorKey(error)) });
  } finally { busy.value = false; }
}
</script>

<template>
  <section class="settings-group" :aria-busy="busy">
    <h2>{{ t('dangerZone') }}</h2>
    <div class="setting-row danger-row">
      <div class="setting-label"><strong>{{ t('wipe') }}</strong><span>{{ t('wipeHint') }}</span></div>
      <button id="wipeBtn" class="setting-action danger" type="button" :disabled="busy" @click="wipe">{{ t('wipeAction') }}</button>
    </div>
  </section>
</template>
