<script setup lang="ts">
import { onMounted, onUpdated } from "vue";
import type { SidepanelControls } from "../../../src/sidepanel/useSidepanelControls";
import type { Translate } from "../../../src/shared/i18n";
import type { PanelActions } from "../../../src/sidepanel/usePanelActions";
import { usePanelBatches } from "../../../src/sidepanel/usePanelBatches";
import { usePanelReading } from "../../../src/sidepanel/usePanelReading";
import PanelCard from "./PanelCard.vue";

const props = defineProps<{ controls: SidepanelControls; actions: PanelActions; translate: Translate }>();
const emptyIcon = "/icon128.png";
// 定位请求由当前文章适配器发起，分批器读取 pending 以提前下一批。
const reading = usePanelReading(props.controls, () => batches.complete.value);
const batches = usePanelBatches(() => props.controls.visible.value, () => reading.pending.value);
function committed(): void { props.controls.didPaint(); reading.committed(); }
onMounted(committed);
onUpdated(committed);
</script>

<template>
  <Teleport to="#panelEmpty">
    <section v-if="controls.ready.value" id="emptyState" class="empty" :hidden="controls.visible.value.length > 0">
      <img class="empty-icon" :src="emptyIcon" alt="" />
      <h2>{{ translate('sideEmptyTitle') }}</h2><p>{{ translate('sideEmptyHint') }}</p>
    </section>
  </Teleport>
  <Teleport to="#panelItems">
    <section id="items" class="items" aria-live="polite" @dragover="actions.drag.over" @drop="actions.drag.drop" @dragend="actions.drag.cancel">
    <template v-if="controls.ready.value">
      <PanelCard v-for="item in batches.rendered.value" :key="item.id" :item="item" :covers="controls.covers.value"
        :icons="controls.collection.value.icons"
        :current="item.id === controls.currentId.value" :actions="actions" :translate="translate" />
    </template>
    </section>
  </Teleport>
</template>
