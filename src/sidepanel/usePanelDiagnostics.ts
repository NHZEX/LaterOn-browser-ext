import { shallowRef } from "vue";
import { browser } from "wxt/browser";
import { t as tr } from "../shared/i18n";
import type { BootSegments } from "./page";
import type { PanelCache } from "./usePanelCache";

interface SlowResource { readonly name: string; readonly ms: number }
export const panelNow = (): number => performance.now();
export function usePanelDiagnostics(cache: PanelCache, count: () => number) {
  const banner = shallowRef("");
  function saveOpenDiag(record: Readonly<Record<string, unknown>>): void {
    // 诊断只供自检，写入失败绝不影响界面，也不能留下未处理拒绝。
    void browser.storage.local.set({ laterOnPanelDiag: record }).catch(() => {});
  }
  // 页面里加载最慢的几个文件（CSS / JS）。慢在「读页面」还是「读数据」，看这个就知道。
  function slowestResources(): readonly SlowResource[] {
    try {
      const entries = (typeof performance !== "undefined" && performance.getEntriesByType)
        ? performance.getEntriesByType("resource")
        : [];
      return entries
        .filter((entry) => typeof entry.duration === "number" && entry.duration > 150)
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 3)
        .map((entry) => ({
          name: String(entry.name).split("/").pop() || String(entry.name),
          ms: Math.round(entry.duration)
        }));
    } catch {
      return [];
    }
  }

  // 各段的中文名：横幅 / 诊断里都用它，顺序就是显示顺序。
  const bootSegments = () => [
    ["page", tr("segPage")], ["cache", tr("segCache")], ["paint", tr("segPaint")],
    ["data", tr("segData")], ["migrate", tr("segMigrate")], ["other", tr("segOther")]
  ] as const;

  // 慢在哪一段 → 一句话结论（写给人看，不写术语）。
  function slowConclusion(seg: BootSegments): string {
    const worst = bootSegments()
      .filter(([key]) => (seg[key] || 0) > 0)
      .sort((a, b) => (seg[b[0]] || 0) - (seg[a[0]] || 0))[0];
    if (!worst) return "";
    const [key] = worst;
    const ms = seg[key] ?? 0;
    if (document.documentElement.lang === "en") {
      if (key === "page") return "Most time was spent preparing the page — Chrome was opening the side panel or loading its files; the number of saves isn’t the cause.";
      if (key === "cache") return `The local snapshot took ${ms} ms to read, so it will be skipped for the rest of this session.`;
      if (key === "data") return `Reading local storage took ${ms} ms. The cached first screen was shown while it finished.`;
      if (key === "paint") return `Painting the first screen took ${ms} ms. Remaining cards are being rendered in batches.`;
      if (key === "migrate") return `Migrating old covers took ${ms} ms. This should only happen once after upgrading.`;
      return `Finishing up took ${ms} ms.`;
    }
    if (key === "page") return "「准备页面」占了大头 → 是 Chrome 打开侧边栏 / 加载页面文件慢，跟添加的网页数量无关。";
    if (key === "cache") return `「读本地缓存」占了大头（${ms} 毫秒）→ 侧栏的秒开快照读取慢，接下来本次会话会直接跳过它，不再反复卡。`;
    if (key === "data") return `「读取网页数据」占了大头（${ms} 毫秒）→ 本地存储冷的时候这一次读取会慢，列表已先用缓存画出来了。`;
    if (key === "paint") return `「画第一屏」占了大头（${ms} 毫秒）→ 卡片太多，一次画不完（已分批，剩下的后台续画）。`;
    if (key === "migrate") return `「整理旧封面」占了大头（${ms} 毫秒）→ 升级后第一次打开会搬一次封面，之后不会再有。`;
    return `其余收尾花了 ${ms} 毫秒。`;
  }

  // 把「慢在哪一步」直接写在侧栏顶部：不用去设置页翻，也不用盯着转瞬即逝的提示。
  function showSlowBanner({ total, firstPaint, seg, slow }: { total: number; firstPaint: number; seg: BootSegments; slow: readonly SlowResource[] }): void {
    // 只列出真正花掉时间的段（<80 毫秒的不值一提），免得横幅又长又没重点。
    const english = document.documentElement.lang === "en";
    const parts = bootSegments()
      .filter(([key]) => (seg[key] || 0) > 80)
      .map(([key, label]) => `${label} ${seg[key]} ${english ? "ms" : "毫秒"}`);
    const headline = firstPaint < total
      ? (english ? `First screen in ${(firstPaint / 1000).toFixed(1)} s; latest data ready in ${(total / 1000).toFixed(1)} s` : `首屏 ${(firstPaint / 1000).toFixed(1)} 秒可见，最新数据校准完成共 ${(total / 1000).toFixed(1)} 秒`)
      : (english ? `Opened in ${(total / 1000).toFixed(1)} s` : `这次打开用了 ${(total / 1000).toFixed(1)} 秒`);
    const lines = [`${headline}${english ? ": " : "："}${parts.length ? parts.join(" · ") : (english ? "every stage was under 80 ms" : "各段都不到 80 毫秒")}`];
    if (slow.length) lines.push(english ? `Slowest files: ${slow.map((entry) => `${entry.name} ${entry.ms} ms`).join(", ")}` : `最慢的文件：${slow.map((entry) => `${entry.name} ${entry.ms} 毫秒`).join("、")}`);
    const conclusion = slowConclusion(seg);
    if (conclusion) lines.push(conclusion);
    // 数据体积异常大单独说一句：这是「读数据慢」最常见的原因。
    if ((seg.bytes || 0) > 300000) {
      lines.push(english
        ? `Save data is ${Math.round((seg.bytes ?? 0) / 1024)} KB (normally only tens of KB). Large embedded content may be slowing it down.`
        : `网页数据 ${Math.round((seg.bytes ?? 0) / 1024)} KB（正常几十 KB）→ 里面有体积大的内容，建议删掉带大图的旧网页。`);
    }
    banner.value = lines.join("\n");
  }

  // 到底慢在「读存储」还是慢在别的地方，一眼能看出来，不用猜。
  function report(seg: BootSegments, bootStart: number, cacheHit: boolean): void {
    const total = Math.round(panelNow() - bootStart);
    // 命中快照时，用户在真实存储返回前就已经能操作；把“首屏可见”和“后台校准完成”
    // 分开记录，避免一个 6 秒的冷存储读数让人误以为界面也白等了 6 秒。
    const firstPaint = cacheHit ? seg.page + seg.cache + seg.paint : total;
    // 「其余」= 总耗时里没被任何一段认领的部分（比如等待浏览器调度、脚本解析）。
    const other = Math.max(0, total - (seg.page + seg.cache + seg.paint + seg.data + seg.migrate));
    const full = { ...seg, other };
    // 数据超过 300 KB 就值得一说：正常只有几十 KB，大说明里面混进了图片之类的大块内容。
    const slow = slowestResources();
    try { console.info(`[LaterOn] 打开耗时 总 ${total} 毫秒`, full, slow); } catch {}
    // 本地快照读起来比预期的慢很多 → 说明这台机器上 localStorage 本身就是慢的，
    // 那就别再一遍遍去读它了（集合更新会安排快照写入，慢起来是叠加的）。
    if (seg.cache > 400) cache.disable();
    // 存一份到存储里：设置页「自检信息 → 侧栏打开耗时」也能看到。
    saveOpenDiag({
      at: Date.now(),
      page: seg.page,
      cache: seg.cache,
      paint: seg.paint,
      data: seg.data,
      migrate: seg.migrate,
      other,
      bytes: seg.bytes || 0,
      total,
      firstPaint,
      cacheHit,
      items: count(),
      localStorageSlow: cache.isSlow(),
      localStorageOk: cache.probe(),
      slow
    });
    // 只有「真的等住了」才在界面上说话：1 秒以内是正常水平（冷启动时读一次存储
    // 本来就要几百毫秒，而列表早已先用秒开缓存画出来了），弹横幅反而像在报错。
    // 数据照样每次都存进诊断，去设置页「自检信息 → 侧栏打开耗时」随时能翻。
    if (total > 2000) showSlowBanner({ total, firstPaint, seg: full, slow });
  }

  return { banner, report };
}
