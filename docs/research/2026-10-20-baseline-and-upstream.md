# 上游候选功能调研摘要

来源：2026-10-20 / 22 的历史只读调研，2026-11-05 对 pasiooooo 的复查，以及 2026-11-14 / 16 对后续提交的再次核对；其他 fork 未重新完整扫描。这里只保留候选方向的参考、建议与接入限制，任务状态及排期以 [roadmap](../roadmap.md) 为准。建议不等于用户已批准实施，也不代表当前产品能力。

比较基线：[上游 `a1a531325e4237f94a74a626296261991b16b4e0`](https://github.com/gaoyiiiii/LaterOn/tree/a1a531325e4237f94a74a626296261991b16b4e0)。重新启动某项评估时，应重新确定比较提交与实际需求，不能把旧 fork 的行为直接当作当前产品承诺。

## pasiooooo 分支复查（2026-11-14 / 16）

本次固定比较 [pasiooooo `24ae2db5263665569210ee1d584218d5f79a4570`](https://github.com/pasiooooo/LaterOn/tree/24ae2db5263665569210ee1d584218d5f79a4570)（提交时间 2026-11-08，版本 1.74.5）与 StaySide `f2b613f`（1.77.0）；双方版本号独立。相对上次固定提交 `7a8272d`，新增 8 次提交，见[完整差异](https://github.com/pasiooooo/LaterOn/compare/7a8272deb5e6ea7cf55202addbc923299a59e2da...24ae2db5263665569210ee1d584218d5f79a4570)。本轮只审查提交、代码与测试内容，没有运行该分支或连接真实 WebDAV；外部分支的测试声明不作为本项目已验收的证据。2026-11-09 至复查日未见更新提交。

融合建议：按功能和行为移植，复用 StaySide 的 Vue / TypeScript、共享选项目弹窗和存储协调器。对方仍以原生 JavaScript 页面为主，整批合并或直接摘取提交会带回旧页面结构和存储路径。WebDAV 的需求优先级保持不变；本轮 diff 未改动 `webdav-sync*`。

### 相对 `7a8272d` 的新提交摘要

| 提交 | 意图 | 对本项目 |
| --- | --- | --- |
| `b892015` | 忽略本地 agent 状态 | 无关 |
| `df6331f` | 大型库 IndexedDB 本地索引；保存时 tab identity 竞态修复 | 索引偏书签库 / 万级，暂不融合；竞态修复可随批量保存行为对照 |
| `e37f626` | 启动 / 升级性能验收文档 | 无关 |
| `52623b1` | 透明封面在阅读库 / 书签库统一；发 1.74.3 | 小样式，仅在本仓同类问题时借鉴 |
| `66ba8cad` | Quick Switcher 可配置四模式、搜活动标签、favicon | 可加重「仅阅读库」候选；完整 QS 不直接移植 |
| `ef582697` | QS 验收文档 | 无关 |
| `fbb40d1` | 选项目弹窗展示已有归属与确认结果预览；发 1.74.5 | **并入选项目弹窗首批** |
| `24ae2db` | 1.74.5 发布包校验文档 | 无关 |

| 候选 | 本次发现与接入建议 | 固定源码依据 |
| --- | --- | --- |
| 选项目弹窗：筛选与新建合用输入框 | 输入时筛选已有项目，非空且无匹配时明确提示新建；仅确认才创建。适合迁入本地共享弹窗，覆盖添加和移动，保留名称限制、失败重试与重复提交保护。 | [picker-ui.js](https://github.com/pasiooooo/LaterOn/blob/24ae2db5263665569210ee1d584218d5f79a4570/picker-ui.js) |
| 选项目弹窗：键盘与焦点保护 | 提前隔离网页快捷键，处理输入法、Tab 焦点循环、关闭后的焦点恢复及按键释放。适合借鉴，需要配合注入时机和弹窗生命周期；不能只复制一段事件监听。 | [picker-keyboard-guard.js](https://github.com/pasiooooo/LaterOn/blob/24ae2db5263665569210ee1d584218d5f79a4570/picker-keyboard-guard.js) |
| 选项目弹窗：已有归属提示与确认结果预览 | 打开「选项目」时根据当前收藏库判断这批网页是否已收藏、在哪个项目；若都在同一项目则预选该项目。切换目标时预览确认后「新增 / 保留 / 移入」数量（按规范化 URL 去重）。打开弹窗本身不写入；确认后才保存或移动。应与筛选新建、焦点保护同一迭代，不另开大项。 | [picker-ui.js](https://github.com/pasiooooo/LaterOn/blob/24ae2db5263665569210ee1d584218d5f79a4570/picker-ui.js)、对方 [添加时项目归属说明](https://github.com/pasiooooo/LaterOn/blob/24ae2db5263665569210ee1d584218d5f79a4570/docs/add-project-context.md) |
| 搜索结果页标题 | 从 Google、Bing、百度等搜索 URL 的查询参数生成具体标题，补充本地已有的泛化标题过滤；沿用本地提取链路并保护手动编辑标题。适合作为独立小项评估。 | [url-utils.js](https://github.com/pasiooooo/LaterOn/blob/24ae2db5263665569210ee1d584218d5f79a4570/url-utils.js)、[page-metadata.js](https://github.com/pasiooooo/LaterOn/blob/24ae2db5263665569210ee1d584218d5f79a4570/page-metadata.js) |
| 当前网页资料缓存 | 会话内复用当前标签页的元数据，并合并同时发起的提取；有潜在性能收益，先测重复提取与等待成本，再决定接入范围，详见下文。 | [current-page-background.js](https://github.com/pasiooooo/LaterOn/blob/24ae2db5263665569210ee1d584218d5f79a4570/current-page-background.js) |
| Quick Switcher | 快捷键弹出本机搜索，覆盖阅读库及已授权范围内的书签；默认复用精确 URL 匹配的标签，也可明确新开。可先评估仅搜索阅读库的独立版本，不必绑定书签库；不是正文搜索，快捷键需保留本项目翻译并核对默认命令数量。对方后续加重了四模式、活动标签与 favicon，完整链不直接移植。 | [quick-switcher-background.js](https://github.com/pasiooooo/LaterOn/blob/24ae2db5263665569210ee1d584218d5f79a4570/quick-switcher-background.js)、[搜索](https://github.com/pasiooooo/LaterOn/blob/24ae2db5263665569210ee1d584218d5f79a4570/quick-switcher-search.js) |
| 原生书签库及预览 | 以浏览器书签树为唯一真源，按需申请权限，支持文件夹范围、双库切换和独立预览缓存；修改、移动和删除直接影响真实书签。需要单独确认产品范围与操作边界。跨设备依赖浏览器自身书签同步，不同步 StaySide 的项目、阅读状态或阅读位置；预览也不是整页存档。对方后续的大型库 IndexedDB 索引与此强绑定，不可单摘。 | [bookmark-sync.js](https://github.com/pasiooooo/LaterOn/blob/24ae2db5263665569210ee1d584218d5f79a4570/bookmark-sync.js)、[预览](https://github.com/pasiooooo/LaterOn/blob/24ae2db5263665569210ee1d584218d5f79a4570/bookmark-previews.js)、[设计说明](https://github.com/pasiooooo/LaterOn/blob/24ae2db5263665569210ee1d584218d5f79a4570/docs/bookmark-library.md) |
| 自定义已读保留天数 | 支持任意非负整数天数及留空关闭清理。本项目已有独立关闭开关；可借鉴正整数自定义，`0` 天立即清理旧已读项与现有迁移保护有冲突，不能直接照搬。 | [变更说明](https://github.com/pasiooooo/LaterOn/blob/24ae2db5263665569210ee1d584218d5f79a4570/CHANGELOG.md)、[本地维护规则](../../src/background/maintenance.ts) |
| 侧栏首屏与样式统一 | 对方改进双库切换、首帧主题和公共控件；本项目已实现骨架屏及非阻塞样式加载，需要按具体缺陷核对，避免整体移植另一套页面样式。 | [对方变更说明](https://github.com/pasiooooo/LaterOn/blob/24ae2db5263665569210ee1d584218d5f79a4570/CHANGELOG.md)、[本地侧栏启动](../../src/sidepanel/boot.ts) |
| 透明封面统一 | 阅读库与书签库占位一致。仅在本仓出现同类视觉问题时借鉴行为，不整体移植书签库样式。 | [对方变更说明](https://github.com/pasiooooo/LaterOn/blob/24ae2db5263665569210ee1d584218d5f79a4570/CHANGELOG.md) |

### 当前网页资料缓存的含义与边界

把刚从当前标签页提取的标题、摘要、封面和来源临时记住，后续需要时直接复用。例如关闭侧栏后重新打开，或切换阅读库 / 书签库时，不必对同一页面反复提取；同时发起的请求可以共用同一次任务。这里描述的是对方行为和候选设计，本项目尚未接入。

对方通过 `storage.session` 保存会话缓存，上限 20 个标签页、约 1 MiB；完整资料有效 15 分钟，不完整资料允许较快重试。页面跳转、同网址刷新及关闭标签页会使旧资料失效，应用异步结果前也要核对页面身份；浏览器重启后缓存不保留。这些容量与期限仅是参考值，不直接成为 StaySide 的配置或承诺。

它不保存网页正文或整页资源，不能在原页面失效后离线阅读，也不等于自动加入收藏；缓存不进入收藏备份或跨设备同步。实施前先测现有单侧栏的重复抓取成本，再确认适用调用方、容量、过期、刷新重试和迟到结果丢弃规则；不能复用过期缓存覆盖用户保存或手动修改的资料。

## 网址导入、标签收集与 WebDAV

初次参考 [pasiooooo 固定提交 `d12e7293270a8822ffe54b0b54dae13cb5f1c9fa`](https://github.com/pasiooooo/LaterOn/tree/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa)。2026-11-05 与 2026-11-14 / 16 复查均确认，后续提交没有修改 `webdav-sync.js`、`webdav-sync-core.js` 和 `webdav-directory.js`，下述 WebDAV 限制仍然成立。

- **网址导入（ITER-005，已搁置）**：文本 / TXT 先写入收藏，再持久化队列补抓资料；不创建或抢占标签页，保留手动编辑。后台 HTML 不执行页面脚本，登录页和动态页面可能缺资料；任务恢复不等于失败项无限重试。接入须复用本项目 URL 规则、共享写队列及备份 epoch，而不是移植旧设置页直接读改写路径。参考 [导入](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/import-urls-background.js) 与 [资料队列](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/import-metadata-background.js)。
- **选中标签 / 标签组（ITER-006）**：先固定当前窗口的目标快照，再选项目；范围变化不应改变在途任务。fork 重用了翻译快捷键并删除翻译，本项目保留翻译，因此不能原样接入命令映射。参考 [批量范围](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/tab-batch-background.js)。
- **WebDAV（ITER-007）**：fork 有每日完整 JSON 备份、本机同步基线和删除标记，但上传的物化备份不包含远端删除墓碑；缺少该服务器基线的新设备可能把本地旧条目补回。PUT 虽可读取响应 ETag，却没有 `If-Match` / `If-None-Match` 条件写入；上传回读无法阻止另一设备随后覆写。首次接入自动合并、同记录冲突选单一赢家，没有冲突预览与用户选择。可借鉴网络请求不占本机写队列、基线与重试恢复的思路，协议仍须按本项目的并发、删除、首次接入、独立资源与备份契约重新设计。凭据本地保存不等于加密，真实服务尚未验收。参考 [同步](https://github.com/pasiooooo/LaterOn/blob/24ae2db5263665569210ee1d584218d5f79a4570/webdav-sync.js) 与 [合并](https://github.com/pasiooooo/LaterOn/blob/24ae2db5263665569210ee1d584218d5f79a4570/webdav-sync-core.js)。

## 可选 AI 归类（ITER-015）

参考 [Hyacehila 固定提交 `bdea4343796f3b4729495560e6bfcfde5c323001`](https://github.com/Hyacehila/LaterOn/commit/bdea4343796f3b4729495560e6bfcfde5c323001)，对应历史 PR #6。至 2026-11-14 复查时 PR 仍 open、头提交未变，无后续评论。

值得保留的方向：先收藏再归类，失败留在等待整理；不自动建项目，不批量重排历史收藏。应用结果前复核条目、项目和配置，尊重用户在途手动修改；未知结果的付费请求不自动重发。

接入前明确远程提取发送 URL、归类发送正文与项目定义的边界，以及敏感参数、密钥、失败记录和主动清理策略。旧实现密钥与任务记录本地未加密，失败记录可能保留简介，七天清理依赖后续入队；不能直接照搬。应沿用本项目队列与 epoch，覆盖导入、清空、删除、取消和重启恢复。历史作者报告未调用真实服务，不能据此判断分类准确率、费用或服务兼容性。

## 其他历史参考

- ITER-011：首次搜索项目定位，[PR #4](https://github.com/gaoyiiiii/LaterOn/pull/4)，历史分支头 `1ccbd155`；当前 Vue 页面应先复现再评估。
- ITER-012：本地 PDF，[Issue #2](https://github.com/gaoyiiiii/LaterOn/issues/2)；产品范围、权限和重新打开方式尚未确定。
- gaoyiiiii/LaterOn `main` 至复查日仍停在 `a1a5313`；[Issue #9](https://github.com/gaoyiiiii/LaterOn/issues/9) 为 WebDAV 用户诉求信号，不是实现。

完整原始调研可用 `git show 3057c62:docs/research/2026-10-20-baseline-and-upstream.md` 回溯。上次固定点 `7a8272d` 的复查正文见提交 `d5a17da`。
