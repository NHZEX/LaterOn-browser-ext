# LaterOn 项目迭代调研记录

记录日期：2026-10-20（Asia/Shanghai）。用途：保存当前架构、上游社区与相关 fork 的调研结果，作为自维护版本的迭代依据。

实施进展（更新至 2026-10-22）：已在现有代码基线上完成数据写入、备份恢复、侧栏布局与调宽改进，当前自维护版本为 `1.69.0`，新增 The Marvellous Suspender 冻结页支持。未整体切换到其他 fork，也未移植其 WebDAV、网址列表导入或标签收集功能。下文架构与社区数据保留 2026-10-20 调研快照；实施结果见「迭代实施记录」，后续评估社区现状时应重新查询。

## 项目与版本基线

| 项目 | 调研时状态 |
| --- | --- |
| 本地仓库 | `LaterOn-browser-ext` |
| 自维护远程 origin | [NHZEX/LaterOn-browser-ext](https://github.com/NHZEX/LaterOn-browser-ext) |
| 上游 upstream | [gaoyiiiii/LaterOn](https://github.com/gaoyiiiii/LaterOn) |
| 本地分支 | `main` |
| 本地及上游提交 | `a1a531325e4237f94a74a626296261991b16b4e0` |
| 调研时扩展版本 | `1.66.1` |
| 技术形态 | 原生 JavaScript、HTML、CSS，Chrome Manifest V3 |
| 声明的最低浏览器版本 | Chrome / Edge 121 |
| 协议 | MIT，仓库包含 LICENSE |

初步判断：现有收集、项目整理和阅读流程值得复用，适合先建立个人定制版本。长期维护需要由自身承担核心数据可靠性与浏览器兼容工作；社区规模尚不足以证明持续维护能力。

## 调研时架构与功能（2026-10-20）

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| 后台协调 | [background.js](../../background.js) | 浏览器事件、消息路由、保存与去重、条目修改与删除、定时清理 |
| 全屏资料库 | [library.js](../../library.js)、library.html、library.css | 项目图板、网页卡片、搜索、筛选、拖拽和批量处理 |
| 浏览器侧栏 | [sidepanel.js](../../sidepanel.js)、sidepanel.html、sidepanel.css | 当前页收集、阅读定位、轻量管理、缓存首屏与耗时诊断 |
| 设置 | [settings.js](../../settings.js)、settings.html | 外观、语言、快捷键诊断、导入导出、清空数据 |
| 网页内容脚本 | content-metadata.js、content-translation.js、content-folder-picker.js、content-reading-position.js | 元信息提取、本机翻译、项目选择、滚动位置记录与恢复提示 |
| 阅读位置后台 | reading-position-background.js | 为已收藏网页注入脚本、持久化位置、清理孤立记录 |
| 共享能力 | url-utils.js、tab-navigation.js、dialog.js、picker-ui.js、theme.js、i18n.js、onboarding.js、boot.js | URL 规范化、标签复用、通用交互、主题、国际化、引导与启动反馈 |
| 发布 | scripts/build-release.py | 按运行文件白名单构建可复现 ZIP |

模块通过普通脚本、全局对象和 `importScripts` 组合，仓库没有前端框架、打包工具或 package.json。后台按需注入较大的网页脚本，避免全部进入 service worker 冷启动路径。

已有产品功能：

- 快捷键、网页右键和侧栏添加当前网页；批量添加当前窗口的标签页。
- 自动提取标题、摘要、封面、来源和图标，包含 YouTube、抖音等页面适配与服务端 HTML 补救。
- 项目新建、编辑、置顶、排序、归档、恢复、删除，以及“等待整理”。
- 全屏图板与卡片管理；搜索、排序、多选、批量标记、移动、删除和新窗口打开。
- 侧栏定位当前网页，复用已打开的标签页，并同步当前阅读项与阅读筛选。
- 未读、在读、已读三种状态；“未读”筛选包含未读和在读。
- 滚动位置记录与用户确认后恢复；已读内容默认 30 天后清理，可设为 30 至 180 天。
- 中文与英文、浅色与深色及跟随系统、新手引导、JSON 备份恢复。
- `Alt+2` 调用浏览器本机 Translator 能力插入中文译文。可用性依赖运行时 API，不能仅用最低浏览器版本判断。

### 数据与写入流程

| 存储键 | 内容 |
| --- | --- |
| `laterOnItems` | 网页数组，含 ID、URL、标题、摘要、图片、来源、项目、保存时间、阅读状态等 |
| `laterOnProjects` | 项目及简介、置顶、归档等信息 |
| `laterOnCovers` | 上传封面的 data URL；条目通过 `local://<id>` 引用 |
| `laterOnOrder` | 各项目或范围下的自定义网页顺序 |
| `laterOnReadingPositions` | 条目 ID 对应的纵向滚动像素位置 |
| `laterOnSettings` | 外观、语言、保存方式和清理期限 |
| `laterOnCurrentItem`、`laterOnFilter` 等 | 当前阅读项与界面状态 |

正式数据位于 `chrome.storage.local`。待确认批量任务位于 `chrome.storage.session`；侧栏另用页面 localStorage 保存首屏快照，再用正式存储校准。

保存、条目修改、删除和自动清理共用后台 `itemWriteQueue`，提交前读取最新数据。界面通过 runtime 消息请求条目变更，通过 `storage.onChanged` 更新显示。项目、排序、导入、清空和部分迁移仍有直接写存储路径。

调研时上游导出包含网页、项目、封面和排序，不含设置与阅读位置。清空网页会保留项目和设置。

核心数据保存在本地，没有发现 LaterOn 自有服务端同步链路；补抓原网页 HTML、加载远程封面和图标仍会产生网络请求。

### 架构问题与验证状态

- **维护成本已确认：** library.js 约 2,500 行，sidepanel.js 约 1,560 行；两页重复实现状态兼容、筛选、封面处理和条目交互。全屏搜索匹配 URL，侧栏搜索不匹配 URL，需明确差异是否符合产品预期。
- **并发风险待复现：** 导入、清空和部分迁移绕过后台写入队列，存在用旧快照覆盖并发修改的可能。
- **恢复校验不足：** JSON 导入未完整校验备份版本、项目、封面、顺序及 ID 关联；不同入口的 URL 规范化也未统一。
- **工程入口不足：** 有 53 个独立测试文件，但没有 package.json、依赖锁文件和统一测试命令；许多界面测试依赖 jsdom。
- **真实环境待验收：** SPA 提取时序、站点改版、本机翻译与真实浏览器交互不能仅靠静态检查确认。

本轮实际执行并通过的测试为 `url-utils`、`background-modules`、`item-mutation`、`save-concurrency`、`reading-position-background`，均位于 tests/，后缀为 `.test.js`。未执行完整测试集或真实浏览器验收；不能据此认定全部功能通过。

## 上游社区与 forks 快照

| 指标 | 2026-10-20 调研结果 |
| --- | --- |
| Stars | 275 |
| Forks | 22，包含 NHZEX/LaterOn-browser-ext |
| 已合入代码的贡献者 | 1 人，gaoyiiiii |
| 主分支提交 | 45 次 |
| 外部 PR | 1 个待处理，0 个已合并 |
| Issues | 4 个，全部未关闭；此处不把 PR 计为 Issue |
| 最近主分支提交 | 2026-10-12 |
| 仓库创建日期 | 2026-09-26 |

查询采用 GitHub 实时 API；网页缓存曾显示较旧数字。仓库成立约 24 天，距离最近提交 8 天，不足以判断作者已停止维护。

对 22 个 fork 默认分支的比较结果：16 个与上游一致、3 个落后、3 个有独立提交。此统计不覆盖其他功能分支，也不代表这些 fork 会持续维护。

| fork 或 PR | 相对上游的改动 |
| --- | --- |
| [pasiooooo/LaterOn](https://github.com/pasiooooo/LaterOn) | 默认分支领先 12 次提交，含 2 次合并；增加 WebDAV、网址导入和标签批量收集，移除翻译 |
| [zye3776/LaterOn](https://github.com/zye3776/LaterOn) | 领先 2 次提交；保存到侧栏选中项目、侧栏直接新建项目 |
| [wudhlgers/LaterOn](https://github.com/wudhlgers/LaterOn) | 领先 1 次提交；支持 Suspender 冻结的标签页 |
| [Hyacehila PR 4](https://github.com/gaoyiiiii/LaterOn/pull/4) | 功能分支修复首次搜索时卡片所属项目显示错误；尚未合入 |

已出现的用户需求：

- [Issue 1](https://github.com/gaoyiiiii/LaterOn/issues/1)：收藏 Suspender 冻结的标签页。
- [Issue 2](https://github.com/gaoyiiiii/LaterOn/issues/2)：收藏浏览器中打开的本地 PDF。
- [Issue 3](https://github.com/gaoyiiiii/LaterOn/issues/3)：允许已读内容不自动删除。
- [Issue 5](https://github.com/gaoyiiiii/LaterOn/issues/5)：区分 hash 路由不同的页面，避免错误去重。

## pasiooooo 版本详细调研

比较基线为上游 `a1a531325e4237f94a74a626296261991b16b4e0`，fork 主分支为 `d12e7293270a8822ffe54b0b54dae13cb5f1c9fa`，扩展版本 1.67.4。差异共 30 个文件，新增 1,515 行、删除 368 行。以下为源码分析，未连接真实 WebDAV 服务，也未执行该 fork 的浏览器验收。

### WebDAV 同步与每日备份

新增 webdav-sync.js、webdav-sync-core.js、webdav-directory.js、webdav-settings.js。设置页支持地址、账号密码、测试连接、启用与暂停、立即同步、最近成功时间和错误状态。

- 同步网页、项目、封面、项目与卡片顺序、阅读状态和阅读位置；主题、语言、快捷键和当前界面选择保持本机设置。
- 新配置自动使用服务地址下的 `LaterOn/` 目录；已有旧配置有兼容路径，重新保存前不会直接切换目录。
- 本地修改后等待连续 30 秒无新修改再同步；每 30 秒的 alarm 作为检查及 service worker 休眠后的补充。启动尝试恢复，手动同步可跳过静默期。
- 文件名为 `lateron-backup-YYYY-MM-DD.json`，按设备本地日期生成。同一天有变化时覆写当天完整文件，次日首次成功同步生成新文件；历史日期文件不自动删除，浏览器退出期间不补建。
- 每次上传完整 JSON，不保留当天每次操作历史。备份包含阅读位置，可通过 JSON 导入恢复。
- 日常读取最新日期备份；旧日期文件不参与合并。兼容迁移旧同步文件，保留旧文件。
- 本机保存同步基线、记录版本和删除标记；按记录选择冲突胜出版本，不是字段级合并。首次接入时本地数据补远端缺项，匹配 ID 时远端优先。
- 本地提交接入原 `queueItemWrite`；网络请求不占队列，提交前合并本轮同步期间的新修改。
- 用户名密码仅存本地，使用 Basic Auth，不进入同步 JSON；不支持重定向。请求超时为 20 秒，读写体限制 50 MB。接受 HTTP/HTTPS，实际使用应选择 HTTPS；JSON 本身没有额外加密。

关键限制：远端 PUT 没有 ETag 等条件写入保护。回读验证不能原子阻止另一台设备随后覆写，因此多设备同时编辑可能丢失修改；README 建议设备顺序使用。新设备没有旧基线时，也无法完整识别本地旧副本中的记录曾被其他设备删除。网络恢复依赖周期重试，不能保证立即同步。

### 网址导入与后台补齐资料

新增 import-urls-background.js、import-metadata-background.js、import-metadata-settings.js，设置页支持粘贴网址列表、导入 TXT，并保留 JSON 恢复。

- URL 文本每行一个完整 HTTP(S) 地址，忽略空行，支持 BOM，输入上限 5 MiB；无效行单独计数。
- 新网址先以未读状态进入“等待整理”，标题暂用网址，再进入后台补抓队列。
- 按规范化网址去重；重复网址不新增，但缺失资料可重新排队补抓。
- 优先读取已打开且加载完成的匹配网页，否则后台请求 HTML；不会创建、导航、激活、解冻或关闭标签页。
- 队列持久化；关闭设置页不影响处理，重启后继续尚未完成的任务。单轮最多处理 10 项，或到达 60 秒期限后结束本轮。
- 尊重标题、摘要、封面的手动编辑标记，只补缺失资料，保留阅读状态和所属项目。
- 新增条目与任务队列同批提交，并接入后台写入队列；网络抓取不占队列。
- JSON 导出与恢复增加阅读位置，待处理抓取队列不在导出内容内。

关键限制：后台 HTML 请求不执行站点脚本且不携带 cookies，登录页、动态页面可能无法补齐。网络提取失败可能作为“不完整”结束任务，不能把启动恢复理解成失败项无限自动重试；可重新导入同一网址再次补抓。JSON 恢复仍直接在设置页读改写存储，且去重规则与新网址入口不完全一致，需统一校验和写入策略。

### 标签收集与翻译取舍

| 快捷键 | 上游 1.66.1 | fork 1.67.4 |
| --- | --- | --- |
| Alt+1 | 当前网页 | 当前网页 |
| Alt+Shift+1 | 当前窗口全部网页 | 标签栏选中的网页 |
| Alt+2 | 翻译当前网页 | 当前标签组 |
| Alt+Shift+2 | 无 | 当前窗口全部网页 |

新增 tab-batch-background.js。所选网页限定当前窗口，支持不连续选择和跨标签组；未多选时通常只包含活动页。标签组模式以活动页 groupId 为准，未分组时提示并停止。只添加 HTTP(S)，按标签顺序处理；选择项目之前固定任务范围，之后改变多选或活动标签不影响本次任务。网页与插件图标右键菜单补齐四种入口。

翻译脚本被删除，translation.css 改为只保留收藏通知的 page-notifications.css。旧命令 ID 和自定义绑定被沿用，但含义改变；若保留翻译，移植时需要重新安排命令。manifest 权限与上游相同，没有新增权限。

### 显示修复与发布流程

- 修复侧栏透明封面与默认 Logo 叠加：真实封面存在时隐藏占位，加载失败并耗尽降级尝试后恢复占位。
- 新增 GitHub Actions：推送 `v*` 标签或手动指定已有标签，校验标签与 manifest 版本一致、提取 CHANGELOG 对应说明、构建 ZIP 并发布 Release。
- 延续上游白名单打包与固定 ZIP 时间戳，加入新模块、移除翻译模块，并排除子目录中的 `.DS_Store` 等文件。
- 已有 v1.67.0 至 v1.67.4 Release 和对应 ZIP。发布工作流未运行自动测试。
- 测试改动主要适配新模块和快捷键，没有新增测试文件；未发现 WebDAV、网址导入的专门测试。选中范围、标签组边界、同步冲突与删除传播仍需补测。

## 迭代任务清单（更新至 2026-10-22）

以下优先级沿用调研建议；完成状态按本地已提交实现与验证结果更新，未实施任务仍需按实际需求选择范围。

| ID | 建议优先级 | 任务 | 完成条件 | 当前状态 |
| --- | --- | --- | --- | --- |
| ITER-001 | P0 | 统一导入、清空、迁移等数据写入入口 | 并发保存、导入、删除不会覆盖其他已提交修改，失败可恢复 | 已完成，`1.67.0`；实现与验证见下文 |
| ITER-002 | P0 | 加强 JSON 校验与恢复 | 校验版本、ID 冲突和关联数据，异常备份不破坏现有数据；阅读位置可恢复 | 已完成，`1.67.0`；实现与验证见下文 |
| ITER-003 | P1 | 统一 URL 规范化并处理 hash 路由 | 保存、导入、去重、标签复用规则一致；不同业务页面不错误合并 | 部分完成：备份合并已复用共享规范化；hash 路由策略仍待处理 |
| ITER-004 | P1 | 建立测试依赖与统一执行入口 | 新环境可复现安装依赖与运行测试，区分既有失败和新增回归 | 待排期；本机已跑全量测试，依赖与执行入口尚未项目化 |
| ITER-005 | P1 | 评估移植网址列表导入 | 不抢占标签页；可恢复队列；明确失败重试；保留手动编辑 | 待排期 |
| ITER-006 | P1 | 增加选中标签与标签组收集 | 范围与窗口边界准确；任务快照稳定；决定是否保留翻译及快捷键 | 待排期 |
| ITER-007 | P1 | 评估 WebDAV 同步方案 | 覆盖双设备并发、离线修改、删除传播、首次接入与备份恢复；明确冲突处理 | 待排期 |
| ITER-008 | P1 | 支持关闭已读自动删除 | 永久保留策略明确，归档与已读清理行为一致 | 待排期 |
| ITER-009 | P2 | 抽取全屏与侧栏公共业务逻辑 | 状态、封面、筛选和操作规则共享，保留明确的界面差异 | 部分完成：已共享数据写入客户端；其余业务与渲染逻辑仍待梳理 |
| ITER-010 | P2 | 吸收封面修复与自动发布 | 显示回退正确；版本和说明校验通过；发布前有测试检查 | 部分完成：缺图与加载失败回退已完善；透明封面专项验收、自动发布仍待办 |
| ITER-011 | P2 | 评估吸收 PR 4 | 首次搜索时卡片所属项目显示正确 | 待排期；冻结标签支持拆至 ITER-014 |
| ITER-012 | P2 | 明确本地 PDF 支持边界 | 确认是否纳入产品范围，以及权限、保存与重新打开方式 | 待排期 |
| ITER-013 | P2 | 改善全屏项目列表与侧栏调宽 | 长名称可读、数量独立对齐；支持调宽、记忆宽度与非拖动操作，窄窗口保留内容空间 | 已完成，`1.68.0` |
| ITER-014 | P1 | 支持 The Marvellous Suspender 冻结页 | 按原始 HTTP(S) 网址收集、去重和识别当前页，不依赖冻结扩展打开收藏；元数据不足时合理降级，收藏时不唤醒标签 | 已完成，`1.69.0`；验证范围见下文 |

后续倾向：先验收日常使用中的 The Marvellous Suspender 适配，再选择性评估网址导入、批量收集及小范围修复。WebDAV 有实际价值，但暂不把该 fork 的实现视为已验证的多设备并发同步方案；当前版本继续保留翻译。

## 本轮确认的支持范围（2026-10-22）

### ITER-014：The Marvellous Suspender 冻结页支持

需求来源：[上游 Issue 1](https://github.com/gaoyiiiii/LaterOn/issues/1)。用户日常频繁使用此扩展；下列行为已在 `1.69.0` 实现，先前的 `1.68.0` 不具备此支持。

- **收藏身份一致：** 从 `suspended.html` 的参数还原原始 HTTP(S) 网址与标题，按正常网页结构存储；项目、搜索、阅读状态、编辑、删除和备份复用现有流程。冻结页与已加载网页按同一原网址去重，不把扩展占位网址作为收藏地址。
- **入口一致：** 覆盖快捷键单篇收藏、整窗收藏计数与去重，以及侧栏当前页识别与添加；普通浏览器内部页和无法解析的占位页仍不作为网页收藏。
- **保持冻结状态：** 收藏时不激活、不导航、不解冻标签页，也不向其他扩展的占位页注入网页提取脚本。需要先选项目时，通过可用的 LaterOn 界面完成选择；不能因浮层注入失败而静默漏存或擅自改变项目。
- **元数据允许降级：** 优先保留可获得的原始标题和站点图标，摘要、封面尝试后台 HTML 补抓；登录态和脚本生成的内容可能无法补齐，失败时仍保留有效收藏并显示默认占位。此支持不承诺读取冻结扩展自身缓存的截图或原网页 DOM。
- **正常重新打开：** 收藏记录只依赖原始网页地址，关闭冻结扩展后仍能打开。已有冻结标签的复用、激活后是否恢复原页应在实现时明确并验证，不能仅因网址解析成功就认定打开体验一致。
- **解析边界：** 对照 [TMS v9.0.3 的地址生成与解析实现](https://github.com/gioxx/MarvellousSuspender/blob/v9.0.3/src/js/gsUtils.js)，`uri` 可以是未经整体编码的末尾网址，不能直接用通用参数拆分截断其 `&`、`+`、`#` 或改变已有百分号编码；兼容旧 `url` 编码形式，并测试中文标题、复杂查询参数、无效地址与非 HTTP(S) 目标。

已有 [wudhlgers 的实现（bb460fa）](https://github.com/wudhlgers/LaterOn/blob/bb460fac74ee02933b11ce6295a79a8c901c18b7/url-utils.js) 作为覆盖入口的参考；其 `URLSearchParams` 方案已复现多参数截断、加号变空格和百分号被额外解码的问题。本轮在当前存储架构上实现无损解析与适配，未直接合并该提交。

## 迭代实施记录

此节记录对调研结论和任务状态有影响的进展；逐版本产品说明以 [CHANGELOG.md](../../CHANGELOG.md) 为准。

### 2026-10-21：1.67.0 数据写入与备份恢复

- 提交：`4f338ea`（功能实现）、`93277fd`（版本发布）。对应 ITER-001、ITER-002，并推进 ITER-003、ITER-009、ITER-010。
- 新增 [后台写入协调器](../../modules/storage/coordinator.js) 与 [共享客户端](../../modules/storage/client.js)。网页、项目、封面、排序、阅读位置、导入、清空和迁移接入共享队列；导入后拒绝旧页面基于过期数据继续修改。
- 备份拆为 [格式与校验核心](../../modules/backup/core.js)、[后台处理](../../modules/backup/background.js)、[设置页交互](../../modules/backup/settings.js)。支持合并与覆盖恢复、写入前预览、版本与关联校验、ID 冲突映射及阅读位置恢复，兼容旧版 v2 备份；本机设置保持不变。
- 导出默认排除上传封面等内嵌图片数据，提供可选完整导出；远程图片保留链接。缺图及图片加载失败时显示默认占位。
- 验证：当次 57 个测试文件全部通过，包含备份往返、异常格式、引用映射、幂等合并、并发写入、失败重试、后台重启与旧页面失效，以及缺图显示。并发与异常路径采用自动化模拟验证，不等同于长期真实使用验收。

### 2026-10-21：1.68.0 全屏项目列表与可调侧栏

- 提交：`158aedc`。新增 ITER-013；属于本地界面改进，不代表其他候选任务已一并完成。
- 缩减子项目缩进，保留 32px 缩略图，名称最多两行，数量独立靠右；提供悬停完整名称和键盘聚焦展开。
- 侧栏默认宽 280px，支持在 240–420px 范围内拖动、记忆宽度、双击恢复默认、方向键微调及点击加宽／缩窄。偏好存储键为 `laterOnSidebarWidth`，作为本机界面状态，不进入收藏备份。窄窗口限制宽度，手机布局隐藏调宽入口。
- 验证：全部 58 个测试文件通过；真实浏览器检查覆盖拖动、点击与键盘替代、双击重置、长名称显示、深浅主题、中英文、减少动态效果及 375px／700px／1440px 布局。此验收范围为资料库界面，不覆盖站点提取或本机翻译。
- 发布：已构建白名单 ZIP 并更新本机扩展目录，41 个发布文件与安装包逐项哈希一致；旧版本统一归档到备份目录。尚未引入 GitHub Actions 自动发布流程。

### 2026-10-22：1.69.0 冻结标签页适配

- 对应 ITER-014。共享 [网址工具](../../url-utils.js) 只解析 `chrome-extension://…/suspended.html` 兼容格式；直接提取 `uri` 后的原网址，保持 `&`、`+`、`#` 和现有百分号编码不变，兼容旧 `url` 与整体编码形式。独立解码原标题，拒绝无效地址和非 HTTP(S) 目标。
- 接入快捷键、右键单篇、整窗收藏、元数据查询和侧栏当前页识别；冻结页复用原网址去重并按普通条目保存，不引入依赖冻结扩展的持久字段。跳过对其他扩展页面的提取、翻译和提示注入；摘要、封面尝试后台无 cookies 的 HTML 请求，失败仍保存基础信息并使用既有占位。
- 需要先选项目时，新开 [LaterOn 选择页](../../save-project-picker.html)，复用 `picker-ui.js` 与 [共享选择数据](../../modules/collection/picker.js)，确认或取消后只关闭选择页。批次快照保留冻结标志；确认和取消校验批次 ID，并串行领取，避免旧选择页影响新批次或重复执行。
- 点击收藏时，已有冻结标签参与原网址匹配，只激活该标签及其窗口，不强制导航；是否自动恢复交由 Suspender 设置。没有匹配标签时继续打开普通原网址。`pos` 不转存为 LaterOn 阅读位置，当前 URL 规范化仍沿用既有 hash 比较策略，相关扩展工作保留在 ITER-003。
- 自动化新增 [冻结收藏回归](../../tests/suspended-tabs.test.js) 和 [选择页交互](../../tests/save-project-picker.test.js)，并补充侧栏定位、已有标签复用和旧提取测试的依赖接线。全部 60 个测试文件通过，覆盖用户提供的复杂网址、中文标题、编码兼容、内部页过滤、离线降级、查询与收藏入口、批次过期、取消、重复确认和旧批次隔离。打包白名单校验通过，共 45 个运行文件。
- 隔离 Chromium 同时加载当前 LaterOn 与模拟冻结页扩展，使用真实扩展 API 验证：四种复杂网址完整入库、收藏无冻结页注入或导航、5 个冻结标签重复收集仍保留 4 条收藏、项目选择确认与 Esc 取消、已有冻结标签复用；检查浅色中文、深色英文及 375px 窄窗口。此验证不等同于用户实际安装的 TMS 扩展及其自动恢复设置验收。
- 版本更新为 `1.69.0`；新增运行文件已加入打包白名单，发布目标为 `D:\浏览器扩展\LaterOn`，旧版本统一归档至同级 `LaterOn-backups` 目录。

## 来源与后续维护

- [上游实时仓库元信息 API](https://api.github.com/repos/gaoyiiiii/LaterOn)、[贡献者 API](https://api.github.com/repos/gaoyiiiii/LaterOn/contributors)、[forks API](https://api.github.com/repos/gaoyiiiii/LaterOn/forks?per_page=100)。上述链接返回实时状态，本文表格保留 2026-10-20 快照。
- [上游提交基线](https://github.com/gaoyiiiii/LaterOn/tree/a1a531325e4237f94a74a626296261991b16b4e0)。
- [pasiooooo 完整比较](https://github.com/gaoyiiiii/LaterOn/compare/a1a531325e4237f94a74a626296261991b16b4e0...pasiooooo:d12e7293270a8822ffe54b0b54dae13cb5f1c9fa)。
- [pasiooooo README](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/README.md)、[CHANGELOG](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/CHANGELOG.md)。历史版本说明中的 1.2 秒同步、临时标签补抓已被后续版本替换，以本记录对应提交的实现为准。
- [同步实现](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/webdav-sync.js)、[合并核心](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/webdav-sync-core.js)。
- [网址导入](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/import-urls-background.js)、[补抓队列](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/import-metadata-background.js)。
- [标签范围选择](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/tab-batch-background.js)、[发布工作流](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/.github/workflows/release.yml)、[v1.67.4 Release](https://github.com/pasiooooo/LaterOn/releases/tag/v1.67.4)。

后续每次迭代更新对应任务状态、实际提交、验证结果和遗留问题；新增调研应注明日期及比较提交，避免把历史快照当作实时状态。
