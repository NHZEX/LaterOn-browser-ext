# LaterOn 项目迭代调研记录

记录日期：2026-10-20（Asia/Shanghai）。用途：保存当前架构、上游社区与相关 fork 的调研结果，作为自维护版本的迭代依据。

实施进展（更新至 2026-10-22）：已在现有代码基线上完成数据写入、备份恢复、侧栏布局与调宽改进，并支持 The Marvellous Suspender 冻结页；当前自维护版本为 `1.69.2`，包含当前阅读标记残留修复及 ITER-003 的 hash 路由比较规则。另已完成 ITER-004 的项目环境、测试与发布入口。未整体切换到其他 fork，也未移植其 WebDAV、网址列表导入或标签收集功能。下文架构与社区数据保留 2026-10-20 调研快照，另增 2026-10-22 的公开分支与 AI 方案补查；实施结果见「迭代实施记录」，后续评估社区现状时应重新查询。

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

## 上游与公开分支补查（2026-10-22）

本次通过 GitHub API 查询全部 issues（含已关闭项）、PR 和 fork 列表，并用 `git ls-remote --heads` 检查各外部 fork 的公开分支，再按不同分支头与上游比较。比较基线仍为上游 `a1a531325e4237f94a74a626296261991b16b4e0`。此处补齐原记录未覆盖的内容，不改写前述 2026-10-20 快照。

| 指标 | 2026-10-22 补查结果 |
| --- | --- |
| Stars / Forks | 281 / 22，fork 数包含本项目 |
| Issues / PR | 5 个 issue、2 个 PR，均未关闭；issue 数不包含 PR |
| 扫描范围 | 排除自身 NHZEX 后的全部 21 个 fork，共 24 条公开分支 |
| 非默认分支 | Hyacehila 的两个功能分支、PossibleXone 的 `m-dev`，共 3 条 |
| 上游最近推送 | 2026-10-12；本次补查未发现上游主分支新增提交 |

| 补查对象 | 分支头及内容 | 与现有记录的关系 |
| --- | --- | --- |
| [Hyacehila：AI 功能 PR #6](https://github.com/gaoyiiiii/LaterOn/pull/6) | `codex/ai-tab-organization`，`bdea434`，领先上游 1 个提交；网页提取与新收藏自动归类 | 原记录未覆盖，新增 ITER-015 评估 |
| [Issue #7：AI 预览版](https://github.com/gaoyiiiii/LaterOn/issues/7) | PR #6 的功能介绍、试用包与数据发送说明 | 与 PR #6 合并记录，不重复计为独立功能 |
| [PossibleXone：m-dev](https://github.com/gaoyiiiii/LaterOn/compare/main...PossibleXone:m-dev) | `37a28015`，领先上游 2 个提交；侧栏先选项目再收藏 | 补充实现参考，与已记录的 zye3776 方案重叠 |
| [Hyacehila：搜索修复 PR #4](https://github.com/gaoyiiiii/LaterOn/pull/4) | `fix/library-initial-project-selection`，`1ccbd155`，领先上游 1 个提交 | 已记录为 ITER-011，本次确认位于非默认分支 |

其余默认分支的独立改动仍来自已记录的 pasiooooo、zye3776、wudhlgers；其他可见分支头与上游已有提交相同或落后。除上述 AI 方向和侧栏实现参考外，本次未发现更多尚未收集的独立功能方向。后续扫描应包含非默认分支，避免只比较默认分支而漏掉功能 PR。

### AI 方案的价值与接入判断

审查对象为 [PR #6 的固定提交 `bdea4343796f3b4729495560e6bfcfde5c323001`](https://github.com/Hyacehila/LaterOn/commit/bdea4343796f3b4729495560e6bfcfde5c323001)，基于上游 `a1a5313`。以下为源码初查及作者提供的验收说明，未在本项目中实现或运行该 fork。

- **产品行为：** 先保存新收藏，再根据网页内容、已有项目名称和简介判断归属；没有合适项目、低置信度或失败时保留在“等待整理”。不自动创建项目、不批量重新整理历史收藏、不改写摘要，保留界面手动选项目的入口。
- **可选能力：** 网页提取与归类渠道分开配置；支持浏览器本地 Readability、DeepSeek Fetch、Tavily，以及 OpenAI / Anthropic 兼容接口和决策接口。可保存多个渠道并测试、启用组合，提供分类历史及候选分数。
- **值得借鉴的实现：** 最多同时执行两个任务；应用结果前复核配置、项目和条目归属，减少覆盖用户操作的风险。远程提取可回退本地；判断失败不自动换模型或重试，结果不明的付费请求不自动重发。见 [ai-background.js 的上下文校验与结果提交](https://github.com/Hyacehila/LaterOn/blob/bdea4343796f3b4729495560e6bfcfde5c323001/ai-background.js#L214)。
- **架构适配：** AI 结果通过原 `queueItemWrite` 提交，但该 PR 另增 [data-background.js](https://github.com/Hyacehila/LaterOn/blob/bdea4343796f3b4729495560e6bfcfde5c323001/data-background.js#L4) 处理其他数据写入。本项目已有共享存储协调器和新版备份恢复流程，接入时应沿用当前入口，重新核对导入、清空、删除、项目归档与在途任务的关系；不直接整体合并旧架构。
- **数据范围与保留：** 远程提取接收 URL，归类服务接收清理后的网页内容和项目定义；不发送浏览器 Cookie。配置、密钥和记录保存在本地且未加密，不进入收藏备份。源码任务记录含原始 URL 与简介；成功路径删除简介，失败路径保留，终态任务的七天清理仅在后续任务入队时触发。接入前需明确敏感参数处理、记录保留与主动清理规则。见 [任务入队](https://github.com/Hyacehila/LaterOn/blob/bdea4343796f3b4729495560e6bfcfde5c323001/ai-background.js#L162)及[结果与失败处理](https://github.com/Hyacehila/LaterOn/blob/bdea4343796f3b4729495560e6bfcfde5c323001/ai-background.js#L235)。
- **验证边界：** 作者报告 60 个测试文件通过，并使用本地模拟服务完成组合、任务恢复和真实扩展交互验收；PR 明确说明未调用真实服务 API。这些结果不能证明真实模型的分类准确率、实际费用或各服务兼容性。本次未复跑其测试，不能将作者结果视为本项目验收。

建议将其作为可选 AI 辅助归类方案单独评估，优先借鉴本地提取、结果复核和请求恢复策略；具体渠道范围、交互和数据保留另行设计。

### 已收集需求的新增反馈

[Issue #3 的 2026-10-21 评论](https://github.com/gaoyiiiii/LaterOn/issues/3#issuecomment-6310874023)进一步表达了替代书签、永久保留收藏的需求。它增强了 ITER-008 的需求依据，尚不构成另一项独立功能。建议推进顺序为 ITER-004 测试入口、ITER-008 关闭自动删除，再评估 ITER-015；此为排期建议，未开始实现。

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

以下优先级沿用调研建议；完成状态按本地实现与验证结果更新，未提交或未发布的改动单独标注，未实施任务仍需按实际需求选择范围。

| ID | 建议优先级 | 任务 | 完成条件 | 当前状态 |
| --- | --- | --- | --- | --- |
| ITER-001 | P0 | 统一导入、清空、迁移等数据写入入口 | 并发保存、导入、删除不会覆盖其他已提交修改，失败可恢复 | 已完成，`1.67.0`；实现与验证见下文 |
| ITER-002 | P0 | 加强 JSON 校验与恢复 | 校验版本、ID 冲突和关联数据，异常备份不破坏现有数据；阅读位置可恢复 | 已完成，`1.67.0`；实现与验证见下文 |
| ITER-003 | P1 | 统一 URL 规范化并处理 hash 路由 | 保存、导入、去重、标签复用规则一致；不同业务页面不错误合并 | 已完成，`1.69.2`；规则边界及验证见下文 |
| ITER-004 | P1 | 建立测试依赖与统一执行入口 | 新环境可复现安装依赖与运行测试，区分既有失败和新增回归 | 已完成；环境、依赖、测试与发布命令已项目化，本机验证通过；CI 待远端运行 |
| ITER-005 | P1 | 评估移植网址列表导入 | 不抢占标签页；可恢复队列；明确失败重试；保留手动编辑 | 待排期 |
| ITER-006 | P1 | 增加选中标签与标签组收集 | 范围与窗口边界准确；任务快照稳定；决定是否保留翻译及快捷键 | 待排期 |
| ITER-007 | P1 | 评估 WebDAV 同步方案 | 覆盖双设备并发、离线修改、删除传播、首次接入与备份恢复；明确冲突处理 | 待排期 |
| ITER-008 | P1 | 支持关闭已读自动删除 | 永久保留策略明确，归档与已读清理行为一致 | 待排期；2026-10-21 上游评论补充永久保留需求，见补查记录 |
| ITER-009 | P2 | 抽取全屏与侧栏公共业务逻辑 | 状态、封面、筛选和操作规则共享，保留明确的界面差异 | 部分完成：已共享数据写入客户端；其余业务与渲染逻辑仍待梳理 |
| ITER-010 | P2 | 吸收封面修复与自动发布 | 显示回退正确；版本和说明校验通过；发布前有测试检查 | 部分完成：缺图与加载失败回退已完善；透明封面专项验收、自动发布仍待办 |
| ITER-011 | P2 | 评估吸收 PR 4 | 首次搜索时卡片所属项目显示正确 | 待排期；冻结标签支持拆至 ITER-014 |
| ITER-012 | P2 | 明确本地 PDF 支持边界 | 确认是否纳入产品范围，以及权限、保存与重新打开方式 | 待排期 |
| ITER-013 | P2 | 改善全屏项目列表与侧栏调宽 | 长名称可读、数量独立对齐；支持调宽、记忆宽度与非拖动操作，窄窗口保留内容空间 | 已完成，`1.68.0` |
| ITER-014 | P1 | 支持 The Marvellous Suspender 冻结页 | 按原始 HTTP(S) 网址收集、去重和识别当前页，不依赖冻结扩展打开收藏；元数据不足时合理降级，收藏时不唤醒标签 | 已完成，`1.69.0`；验证范围见下文 |
| ITER-015 | P2 | 评估可选 AI 辅助归类 | 明确新收藏与手动操作边界、数据发送与记录保留；适配共享写入队列；验证任务取消、恢复、失败降级及真实服务效果 | 候选，未实现；参考 PR #6，需按当前架构设计 |
| ITER-016 | P1 | 接入 WXT 兼容构建 | 保留现有运行源码和加载语义；统一构建与发布；验证原目录替换后扩展身份和已有数据兼容 | 已提交 `31dd863`，已同版本安装供用户试用；本地验证通过，用户浏览器加载待验收，Vue 页面迁移另行安排 |
| ITER-017 | P1 | 收敛 WXT 构建与发布工具链 | 产物统一至 `.output`，使用 WXT ZIP；校验迁至 Node，开发与 CI 不再依赖 Python | 已提交 `fef27a3`，同版本构建与本机发布校验通过；安装文件一致，用户加载待验收，远端 CI 待运行 |
| ITER-018 | P1 | 迁移 Node 本机部署并收敛构建校验 | 构建、测试、部署不调用 PowerShell；移除构建快照，仅保留最终 ZIP 检查与部署保障；清理旧 `dist` | 迁移与校验收敛本机验证完成；`dist` 递归删除被自动审批拒绝，目录保留 |

后续倾向：ITER-004、ITER-016 已提交，WXT 同版本试装包等待用户浏览器验收，远端 CI 仍待运行。ITER-017 收敛构建与打包流程，后续按需求评审单页面 Vue 试点与 ITER-008 的永久保留策略，再评估 ITER-015 的可选 AI 辅助归类。网址导入、批量收集及小范围修复按实际需求选择。继续观察日常使用中的 The Marvellous Suspender 适配。WebDAV 有实际价值，但暂不把该 fork 的实现视为已验证的多设备并发同步方案；当前版本继续保留翻译。

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

### 2026-10-22：1.69.1 当前阅读标记残留修复

- TMS 实际使用反馈显示“正在读”标记残留，界面其他操作正常。复现发现：侧栏切到未收藏网页后只清除自身高亮，未清除共享的 `laterOnCurrentItem`，全屏界面及重新打开的侧栏因此继续显示旧标记。
- 将共享标记同步移至收藏匹配分支之外：匹配到条目时写入 ID，离开条目时写入 `null`。保留当前冻结页的收藏识别及“已添加”状态，也保留从侧栏展开全屏时的定位上下文。
- 回归覆盖冻结收藏与未收藏网页切换、侧栏重开、旧标签资料迟到及全屏高亮清除；不调整标签页打开或冻结恢复行为。
- 验证：7 个相关测试文件全部通过。版本更新为补丁版 `1.69.1`，继续使用 45 个文件的白名单安装包；发布目标为 `D:\浏览器扩展\LaterOn`，旧版本归档至同级 `LaterOn-backups`。

### 2026-10-22：1.69.2 网址身份与 hash 路由

- 所有入口使用 [共享网址工具](../../url-utils.js) 生成比较键：单篇与整窗收藏、选择项目前已收藏计数、JSON 备份合并、侧栏当前项、已有标签复用、阅读位置匹配。比较键只用于识别；收藏存储、导出与实际打开保留原网址。备份覆盖恢复仍按备份内容恢复，不额外合并其中条目。
- 明确区分 `#/…` 和 `#!/…` 业务路由；不同路由路径、两种前缀、大小写及路由末尾斜杠均保留区别。普通 `#section`、中文锚点和文本片段不另建网页身份。已有 `www`、外层路径末尾斜杠、追踪参数和 YouTube 视频 ID 兼容规则继续适用。
- 路由内查询参数按原始参数名稳定排序；相同名称的重复参数保持相对顺序。不解码或重新编码路由，不将 `+` 当作空格，不剥离路由内的疑似追踪参数；`%2F` 与 `/`、`C++` 与 `C%2B%2B`、路由内不同参数值均保留区别。第二个 `#` 及后缀保留，避免猜测应用内部语义。官方 [Vue Router hash 模式说明](https://router.vuejs.org/guide/essentials/history-mode.html)确认 fragment 可承载路由；[URLSearchParams 文档](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams)说明其加号和百分号解码行为，因此这里保守保留原始路由字符。
- 外层查询仍去除 `utm_`、`mc_` 前缀参数，以及 `fbclid`、`gclid`、`ref`、`spm`、`igshid` 精确名称；修复此前前缀匹配误删 `reference`、`spmode` 等业务参数的问题。冻结占位页先还原原网址再比较，普通页和冻结页共享身份。
- 边界：未把不以 `/` 或 `!/` 开头的自定义 fragment（如 `#article=1`）猜作路由；此类站点需要明确实例后再增加规则。未重写既有收藏或自动清理历史重复项；过去已因错误去重而漏存的页面需重新收藏。
- 自动化：全部 60 个 `.test.js` 文件通过；新增覆盖普通锚点、两种路由前缀、编码与参数边界、幂等性、冻结单篇与批量去重、收藏计数、备份合并及阅读位置关联、侧栏切换与标签复用。
- 浏览器：全新隔离 Chromium 加载当前源码，验证同一标签仅改变 hash 时，当前项及位置脚本依次关联第一篇、第二篇，未收藏路由清除关联；侧栏同步所属项目与收藏状态，标签复用找到正确路由。此验证覆盖路由身份与关联，不等同于所有 SPA 站点的内容提取验收。
- 发布：对应 ITER-003，按错误去重修复发布补丁版 `1.69.2`。构建 45 个运行文件的白名单安装包并更新 `D:\浏览器扩展\LaterOn`，逐项 SHA-256 校验与安装包一致；旧版 `1.69.1` 统一归档至同级 `LaterOn-backups` 目录。

### 2026-10-22：ITER-004 环境、测试与发布入口

- 提交：`c40e811`。下列内容记录首次工程入口接入时的范围；后续 WXT 构建见 ITER-016。
- 按确认范围先建立工程入口，保留全部运行文件位置与现有普通脚本 / `importScripts` 加载方式。尚未安装 WXT、Vite、Vue 或 TypeScript；后续再评审兼容构建及单页面 Vue 试点，避免同时迁移目录和运行逻辑。
- 新增 `package.json` 与 pnpm 锁文件；执行 `volta pin node@24` 后固定 Node `24.22.1`，`packageManager` 固定 pnpm `12.14.0`，jsdom 固定为已验证的 `26.1.0`。沿用 CommonJS 测试，依赖由项目安装，不再依赖外部 `NODE_PATH`。
- `pnpm test` 统一发现并顺序执行 `tests/*.test.js`，每个文件在独立子进程中运行；失败、超时或异常退出会输出详情并令整体命令失败。新增发布边界回归，覆盖可复现 ZIP、过期产物拒绝、本机安装与备份、重复发布不多建备份、无关目录及仓库根目录保护。
- 统一 `pnpm build`、`pnpm release:check` 与 `pnpm run release:local --dir <安装目录>`。继续复用 Python 白名单打包核心；新增产物与当前源码逐文件比较。本机发布要求显式目标，先暂存与校验，再统一归档旧版、切换目录、校验 SHA-256，失败时尝试回滚。
- 新增 Windows / Ubuntu 的 GitHub Actions，按项目固定版本执行锁文件安装、测试、构建和产物校验；尚未推送运行，不将本机结果视为 Linux 或远端 CI 已验收。开发与发布说明记录于 [README](../../README.md#项目开发)。
- 本机验证：`pnpm install --frozen-lockfile`、`pnpm test`（61/61 文件）、`pnpm build`、`pnpm release:check` 全部通过；另用隔离样例验证测试入口正确返回失败，并通过实际 pnpm 命令验证临时目录安装及重复发布。发布测试只使用 `dist/` 下的临时目录。
- 本轮只修改开发工具和文档，扩展版本仍为 `1.69.2`；未操作实际安装目录。新入口构建仍为 45 个运行文件，ZIP 的 SHA-256 与此前已发布的安装包一致。

### 2026-10-22：ITER-016 WXT 兼容构建

- 固定 WXT `0.21.4`、Vite `8.3.5`，继续沿用 Node / pnpm 项目版本。新增 [WXT 配置](../../wxt.config.mjs) 与独立 `wxt/entrypoints`；原有 HTML、脚本、样式和业务模块保留原位置，未接入 Vue、TypeScript 或页面热更新。
- 由 WXT / Vite 构建一个小型后台入口，通过同步 `importScripts("background-runtime.js")` 加载原后台脚本，保持 classic service worker 的全局作用域与监听注册方式。其他运行资源按白名单原样复制；页面普通脚本顺序、注入脚本文件名、扩展页面路径和存储键保持既有约定。
- [共享运行文件清单](../../scripts/runtime-files.json) 同时供 WXT 资源复制与 Python 打包使用，避免维护两套白名单。构建输出为 `.output/chrome-mv3`，包含 46 个文件；相比原包增加一个后台适配文件。根目录 manifest 仍为唯一配置来源，产物 manifest 必须与其语义一致，权限和版本未变。
- `pnpm build`、`pnpm run release:local --dir <安装目录>` 先执行 WXT，再验证和打包；`pnpm release:check` 验证已有构建与 ZIP。校验覆盖源码、配置与锁文件的输入哈希、输出哈希、完整文件集合、manifest 语义及旧资源逐字节一致性；拒绝过期构建、修改后的产物与额外文件。保留固定 ZIP 时间戳；重复构建结果一致，并对短暂文件锁做有限重试，失败保留已有 ZIP。
- 自动化：锁文件安装通过；全部 61 个测试文件通过。扩展发布回归覆盖构建后的 classic worker 初始化与已有数据修改、过期构建拒绝、产物篡改拒绝、重复构建、旧 ZIP 替换、安装备份与目标目录保护。
- 浏览器：在隔离 Chromium 中先加载旧版运行文件并写入样例数据，再关闭浏览器、以新包替换同一个测试安装目录，使用同一浏览器资料重新加载。扩展 ID 保持一致，已有收藏、项目、设置、阅读位置和顺序均保留；资料库、设置页、侧栏页面、备份导出、收藏写入及元数据 / 项目选择 / 阅读位置脚本注入通过，无页面异常。此结果不代替全部浏览器版本、实际侧栏停靠交互或长期使用验收。
- 初次实现验证时未更新实际安装目录。WXT 包因增加后台入口且重新序列化 manifest，不再与旧包逐字节相同；不能沿用上一阶段的“ZIP 哈希一致”结论。远端 Windows / Ubuntu CI 尚未运行。

### 2026-10-22：WXT 同版本试装包

- 实现提交：`31dd863`。按用户要求先提交当前兼容构建，再使用 `pnpm run release:local --dir "D:\浏览器扩展\LaterOn"` 构建和安装，随后执行 `pnpm release:check`；命令全部通过。
- 扩展版本保持 `1.69.2`，安装目录包含 46 个文件，逐项 SHA-256 与 ZIP 一致。安装包为 `dist/LaterOn-1.69.2.zip`，SHA-256：`D9BA7AF73668635E13FF0A78B2A320B81EC248F9C62DFCC8CE3A9951C602ECB8`。
- 原目录完整备份至 `D:\浏览器扩展\LaterOn-backups\1.69.2-20261022-192030-fe335812`，旧文件哈希校验通过。本次等待用户在既有扩展上重新加载并验收；未自动操作用户浏览器。
- 收敛 `.output` / `dist`、改用 WXT ZIP 并迁移 Python 校验至 Node 已确认作为后续方向，本次试装包仍使用当前已验证的兼容流程。

### 2026-10-22：ITER-017 工具链收敛

- 构建与 ZIP 直接使用 WXT CLI：`pnpm build` 对应 `wxt build`，只生成扩展目录；`pnpm zip` 对应 `wxt zip`，自动构建并打包。扩展目录仍为 `.output/chrome-mv3`，ZIP 为 `.output/LaterOn-<版本>.zip`；测试临时安装目录也移至 `.output`，新流程不再写入 `dist`。旧 `dist` 产物保留为历史文件，不用于当前构建、校验或发布。
- 删除 Python 打包器与自定义构建命令转发层，构建、校验和测试不再调用 Python；移除 CI 的 Python 安装及相关环境变量，CI 使用 `pnpm zip` 生成归档。`release:check` 直接执行 Node 校验，`release:local` 串联 `pnpm zip` 和现有 PowerShell 部署脚本；后者支持 `--dir` 别名并默认读取当前版本的 `.output` ZIP。保留 `AGENTS.md` 的 Python 环境约定，供后续其他脚本使用。
- [Node 校验](../../scripts/check-release.mjs) 复用共享运行文件清单，检查输入与输出哈希、完整文件集合、manifest 语义、文件引用以及旧运行资源逐字节一致性；在 WXT 构建完成、ZIP 写入前和写入后执行对应检查，直接调用 WXT ZIP 也会经过这些检查。固定开发依赖 `fflate@0.8.3` 用于 ZIP 读取校验，不参与扩展运行或正常发布包的创建。
- ZIP 校验检查额外或缺失文件、重复条目、损坏格式及解压内容与当前构建的一致性。WXT 自带打包排序和固定时间戳，重复构建字节一致；底层 ZIP 实现不同于旧 Python 包，ZIP 哈希会改变。WXT 直接写入 ZIP，本轮不再保留旧 Python 的临时文件替换与文件锁重试；打包或校验失败时命令失败，不进入本机目录安装。
- 本机目录安装继续使用 PowerShell 的暂存、完整备份、切换及哈希校验，目标参数和日常命令不变。业务源码位置、兼容后台入口及扩展版本 `1.69.2` 保持当前范围；尚未将旧页面迁为 WXT 编译入口。
- 验证：收敛阶段全量 `pnpm test`（61/61 文件）通过；随后简化为 CLI 后，复验 `release-tools.test.js`、锁文件安装、`pnpm build`、`pnpm zip`、`pnpm release:check` 及实际 `pnpm run release:local --dir <含中文与空格的临时目录>` 均通过。发布专项覆盖 build 不创建 ZIP、WXT ZIP 连续构建一致、旧 ZIP 覆写、classic worker 与已有收藏修改、过期构建和篡改产物拒绝、manifest 权限变化拒绝、ZIP 内容与重复条目等异常拒绝，以及 PowerShell 备份 / 幂等 / 目标目录保护。收敛后的 46 个运行文件与 `D:\浏览器扩展\LaterOn` 当前试装包逐项 SHA-256 一致；未更新该目录。远端 CI 尚未运行，本轮未重复浏览器交互验收。
- 提交与试用：实现提交 `fef27a3` 后，按用户要求再次执行 `pnpm run release:local --dir "D:\浏览器扩展\LaterOn"` 与 `pnpm release:check`，版本保持 `1.69.2`，全部通过。新包 `.output/LaterOn-1.69.2.zip` 的 SHA-256 为 `794DB03DBD05F66C07756C25C315B5ECF07FC2A49BA12073AC45D59EADFC37A6`；46 个安装文件与 ZIP 一致，发布脚本返回 `Already installed`，未重复覆盖或新增备份。用户可对既有扩展重新加载验收。

### 2026-10-22：ITER-018 Node 部署与构建校验简化

- 按用户确认，后续完整迁入 WXT 是既定方向，不再要求编译产物与旧源码逐字节一致，也不要求生成 manifest 与根目录旧配置整体相等。上述条件不能证明运行正确，反而会阻止正常的模块编译、分块和框架配置生成，因此删除对应断言与回归约束。
- 构建记录改为扫描 WXT 实际输出，允许新增编译文件；共享白名单仍负责明确尚未迁移资源的复制范围。保留输入哈希的新鲜度、已记录产物完整性、开发文件排除、MV3 基础字段和引用文件存在性、ZIP 与本次构建一致性等校验。manifest 引用支持编译文件通配符；权限等生成字段不再被强制固定为旧配置。
- [Node 本机部署](../../scripts/publish-local.mjs) 替换 PowerShell 脚本，复用 ZIP 读取校验，使用 Node 文件系统完成暂存、哈希核验、旧目录统一备份、切换、失败回滚及重复发布跳过。保留仓库及其祖先目录保护，拒绝目标目录链接及 ZIP 路径越界；回滚本身失败时保留恢复目录并报告路径。
- 日常命令保持 `pnpm run release:local --dir <安装目录>`，构建和 ZIP 仍直接使用 WXT CLI。移除发布测试中的 PowerShell 调用、CI 显式 `pwsh` 设置及 README 的 PowerShell 环境要求；项目工具仅需 Node / pnpm。`AGENTS.md` 的条件式 PowerShell 使用规范保留，不作为项目运行依赖。
- 验证通过：锁文件安装、全量 `pnpm test`（61/61 文件）、`pnpm build`、`pnpm run release:local --dir <含中文与空格的临时目录>` 以及 `pnpm release:check`。专项覆盖允许编译转换、额外编译文件及有效 manifest 差异，拒绝缺失引用、过期或篡改构建、ZIP 异常；Node 部署覆盖安装、完整备份、幂等、失败回滚、目录链接、根目录 / 仓库 / 祖先保护和路径越界。未更新实际安装目录，扩展版本保持 `1.69.2`；远端 CI 尚未运行。
- 旧 `dist` 已审查为未被当前构建使用的历史产物、测试浏览器资料和调研缓存，没有 Git 跟踪文件。已按授权尝试清理，但自动审批拒绝递归删除并返回 `blocked by policy`，目录尚未移除；当前命令继续只使用 `.output`。

### 2026-10-22：ITER-018 最终 ZIP 检查收敛

- 进一步移除输入与输出哈希快照、`.wxt/compat-build.json` 的读写、`buildInputs` 清单，以及构建完成、ZIP 打包前后重复执行的校验钩子。`pnpm build` 和 `pnpm zip` 直接使用 WXT；配置仅保留尚未迁移资源的复制钩子，不再禁止使用 WXT public 资源。
- [发布检查](../../scripts/check-release.mjs) 只读取最终 ZIP，检查 MV3 名称和版本、manifest 明确引用的文件、开发文件混入，以及损坏 ZIP、重复条目和非法路径；不依赖构建目录或快照，不比较源码、构建目录与 ZIP 的字节一致性。它不承诺旧包新鲜度或功能正确性；正常发布通过 `pnpm zip` 重新构建，功能由测试与浏览器验收确认。
- CI 在 `pnpm zip` 后执行一次 `pnpm release:check`；本地发布则在安装前复用相同的 ZIP 读取检查，避免额外执行一次 CLI 检查。部署仍保留路径保护、暂存完整性、旧目录统一备份、失败回滚及重复发布跳过；此处内容哈希仅服务安装核验和幂等，不约束编译输出。
- 发布专项移除构建快照与重复构建一致性测试，保留构建后台初始化和已有收藏更新、允许编译生成文件及 manifest 合法差异、最终 ZIP 异常拒绝，以及安装、备份、幂等、回滚和目录保护回归。全量 `pnpm test`（61/61 文件）通过；实际 `pnpm run release:local --dir <含中文与空格的临时目录>` 与 `pnpm release:check` 通过，临时目录返回 `Already installed`。未修改业务运行代码、版本号或实际安装目录；远端 CI 尚未运行。

## 来源与后续维护

- [上游实时仓库元信息 API](https://api.github.com/repos/gaoyiiiii/LaterOn)、[贡献者 API](https://api.github.com/repos/gaoyiiiii/LaterOn/contributors)、[forks API](https://api.github.com/repos/gaoyiiiii/LaterOn/forks?per_page=100)。上述链接返回实时状态，本文表格分别保留 2026-10-20 与 2026-10-22 的快照。
- [全部 issues API（含 PR）](https://api.github.com/repos/gaoyiiiii/LaterOn/issues?state=all&per_page=100)、[全部 PR API](https://api.github.com/repos/gaoyiiiii/LaterOn/pulls?state=all&per_page=100)。2026-10-22 补查分别统计 issue 和 PR，并结合公开分支头比较，未将 PR 重复计入 issue 数。
- [上游提交基线](https://github.com/gaoyiiiii/LaterOn/tree/a1a531325e4237f94a74a626296261991b16b4e0)。
- [pasiooooo 完整比较](https://github.com/gaoyiiiii/LaterOn/compare/a1a531325e4237f94a74a626296261991b16b4e0...pasiooooo:d12e7293270a8822ffe54b0b54dae13cb5f1c9fa)。
- [pasiooooo README](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/README.md)、[CHANGELOG](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/CHANGELOG.md)。历史版本说明中的 1.2 秒同步、临时标签补抓已被后续版本替换，以本记录对应提交的实现为准。
- [同步实现](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/webdav-sync.js)、[合并核心](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/webdav-sync-core.js)。
- [网址导入](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/import-urls-background.js)、[补抓队列](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/import-metadata-background.js)。
- [标签范围选择](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/tab-batch-background.js)、[发布工作流](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/.github/workflows/release.yml)、[v1.67.4 Release](https://github.com/pasiooooo/LaterOn/releases/tag/v1.67.4)。

后续每次迭代更新对应任务状态、实际提交、验证结果和遗留问题；新增调研应注明日期及比较提交，避免把历史快照当作实时状态。
