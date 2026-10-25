<script setup lang="ts">
import { onMounted, onUpdated } from "vue";
import type { SidepanelControls } from "../../../src/sidepanel/useSidepanelControls";
import type { Translate } from "../../../src/shared/i18n";
import { usePanelBatches } from "../../../src/sidepanel/usePanelBatches";
import { usePanelReading } from "../../../src/sidepanel/usePanelReading";
import PanelCard from "./PanelCard.vue";

const props = defineProps<{ controls: SidepanelControls; translate: Translate }>();
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
  <Teleport to="#items">
    <template v-if="controls.ready.value">
      <PanelCard v-for="item in batches.rendered.value" :key="item.id" :item="item" :covers="controls.covers.value"
        :current="item.id === controls.currentId.value" :translate="translate" />
    </template>
  </Teleport>
</template>
