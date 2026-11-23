# 浏览器原生同步能否承载 StaySide 收藏

调研日期：2026-11-23。对照 StaySide `f2a53f1`、浏览器官方文档及 Chromium 源码，另用合成条目计算容量。不是规格或排期；未登录测试账号、未写入真实同步区。迭代状态以 [roadmap](../roadmap.md) 为准。

## 现状与平台边界

- StaySide 当前面向开发者模式安装的 Chrome / Edge 121+（[安装说明](../../README.md#1-分钟安装)）。清单已设固定公钥、申请 `storage` 和 `unlimitedStorage`（[清单](../../manifest.json)）；固定 ID 能让不同安装识别为同一扩展，不等于在浏览器云端验证通过（[Chrome 清单 `key`](https://developer.chrome.com/docs/extensions/reference/manifest/key)）。
- 现有 [偏好同步](../architecture.md) 默认关闭，通过 [`sync-background.ts`](../../src/settings/sync-background.ts) 同步主题、语言、默认排序（不是自定义收藏顺序），另可共享不含密码的 WebDAV 预设；不写收藏。现有 [浏览器回归](../../tests/browser/settings-sync.spec.cjs) 在单一配置内写读 `storage.sync`，覆盖设置行为，不证明真实跨设备送达。
- Chrome 需要相应 Google 账号与浏览器同步；离线先本机保存，关掉同步时 `storage.sync` 可以只在本机工作。`set()` 成功或本机 `onChanged` 不等于另一端已收到（[Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage/#sync)、[Chromium 写入与上报](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/extensions/api/storage/syncable_settings_storage.cc#100)）。Edge 的扩展 API 表列出 `storage`，微软也记录了同一微软账号的 Edge 同步，但所查资料未给出独立的 `storage.sync` 配额或本仓侧载包的送达保证；用 Chromium 数值作保守设计参考，分别验证 Chrome → Chrome、Edge → Edge。相同扩展 ID 不会桥接这两个浏览器的账号后端（[Edge 支持的 API](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support)、[Edge 账号同步](https://support.microsoft.com/en-us/edge/sign-in-to-sync-microsoft-edge-across-devices)）。
- Firefox 桌面也记录 100 KiB / 8 KiB / 512 键，需要固定 Add-on ID 和启用附加组件同步；不在本仓支持范围（[Mozilla WebExtensions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/sync)）。

## 扩展同步区容量

Chrome 每个扩展共享 **102,400 B（100 KiB）总量、8,192 B（8 KiB）单键、512 键**；键名和 JSON 序列化值都计入。`set` / `remove` / `clear` 的写入调用上限为 120 次/分钟、1,800 次/小时；可把多个键放进一次 `set`，这不是 WebDAV 请求数或远端送达速率。`unlimitedStorage` 不会扩大 `storage.sync`。单个收藏数组也只是一个键，先碰到 8 KiB 上限（[Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage/#sync)、[Chromium 同步配额实现](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/extensions/api/storage/sync_value_store_cache.cc#35)）。

以 **80 KiB 留给收藏**为估算情景（其余留给偏好、预设、版本或删除记录等，不是产品预算承诺）。每条一个键，用 `Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(item))` 估算；键为 `stayside.collection.item.` 加 UUID，条目用约 70 字节的 URL 和中文标题。下表是合成样本，不是现有用户库实测：

| 合成条目 | 每条含键 | 80 KiB 约容纳 |
| --- | ---: | ---: |
| URL + 标题 | 192 B | 426 条 |
| 再加项目 ID、状态、收藏时间、设备与修订时间 | 362 B | 226 条 |
| 再加 200 个汉字的摘要 | 979 B | 83 条 |

URL 长度、修订模型、项目和删除记录都会改变结果。真实候选范围应在本机按实际序列化尺寸测量，验证时用 `getBytesInUse()` 核对。压缩可以提高密度，无法解除总量或并发限制；走 gzip + Base64 时，仅 Base64 就将字节膨胀约三分之一，80 KiB 文本预算最多容纳约 60 KiB 压缩字节，实际扣除键名、引号和分片元数据后更少。

## 取舍

- **扩展同步区：保留给偏好。** 浏览器传输的是扩展 ID、键和序列化值，不理解 StaySide 的字段或删除语义。两个离线设备分别修改同一收藏的标题和状态，若共享一个键，一个版本可能覆盖另一版本；拆键只能缩小覆盖范围，不能替代冲突处理、删除与重收、旧设备重连等设计。分片也不应假设远端按整库事务收到；不要把小型配置同步直接扩成收藏库同步（[Chromium 同步实体协议](https://chromium.googlesource.com/chromium/src/+/lkgr/components/sync/protocol/extension_setting_specifics.proto)、[Chromium 接收逻辑](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/extensions/api/storage/syncable_settings_storage.cc#266)）。
- **原生书签：如果只想跨设备接着打开网页，优先评估这一条。** Google 文档列出账号可跨设备访问最多 100,000 个书签，是整个账号的书签容量，不是扩展独享；Edge 支持收藏夹跨设备，所查官方资料未确认同等条数。扩展可在用户明确授权后把标题、URL 导出到用户可见的专用文件夹；项目可以映射成文件夹，但不能等价保留 [StaySide 的项目元数据、摘要、状态、封面和阅读位置](../../src/backup/core.ts)。不要把隐藏数据编码进书签，或把书签消失自动解释为删除 StaySide 收藏（[Chrome 账号书签容量](https://support.google.com/chrome/answer/165139?hl=en-0)、[书签 API](https://developer.chrome.com/docs/extensions/reference/api/bookmarks)、[Edge 账号同步](https://support.microsoft.com/en-us/edge/sign-in-to-sync-microsoft-edge-across-devices)）。
- **原生阅读清单：只作 Chrome 备选。** Chrome 的 `readingList` 可处理 URL、标题和已读状态，没有项目及自定义顺序语义；Microsoft 的 API 表把它列为 Edge 不支持的扩展 API。即使两个浏览器的产品都能同步自己的阅读清单，也不能据此假设扩展接口相通（[Chrome 阅读清单 API](https://developer.chrome.com/docs/extensions/reference/api/readingList)、[Chrome 账号同步](https://support.google.com/chrome/answer/165139)、[Edge API 限制](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support#unsupported-apis)）。
- **完整库：保留独立 ZIP 备份，先不启动新同步方案。** 如果真实需求是「新设备能打开这些链接」，下一步只用专用书签目录做一次同浏览器、同账号的两端验证，先验证正常送达，再决定要不要做单向「发送到浏览器书签」。不导入真实敏感 URL，不改其它书签，不自动回写或传播删除。若需求是完整的跨 Chrome/Edge 多端编辑，仅换为浏览器同步后端不解决问题。
