import { shallowRef, watch, type ShallowRef } from "vue";
import { nextCoverFallback } from "../shared/card-media";
import type { PageMetadata } from "./page";

export function usePanelThumbnail(metadata: ShallowRef<PageMetadata | null>) {
  const image = shallowRef("");
  let generation = 0;
  let probe: HTMLImageElement | undefined;
  function detach(): void { if (probe) { probe.onload = null; probe.onerror = null; probe = undefined; } }
  function load(source: string, token: number): void {
    detach();
    if (!source) { image.value = ""; return; }
    const pending = new Image(); probe = pending;
    // 先悄悄试加载，拿到图才覆盖 Logo；旧标签页的图片事件不能污染当前网页。
    pending.onload = () => { if (token !== generation) return; image.value = source; detach(); };
    pending.onerror = () => { if (token === generation) load(nextCoverFallback(source), token); };
    pending.src = source;
  }
  const stop = watch(metadata, value => { image.value = ""; load(value?.image ?? "", ++generation); }, { immediate: true });
  function dispose(): void { generation++; stop(); detach(); }
  return { image, dispose };
}
