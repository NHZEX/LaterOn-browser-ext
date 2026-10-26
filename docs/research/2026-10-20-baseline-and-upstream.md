# 初始架构与上游调研

调研日期：2026-10-20；公开社区与分支补查：2026-10-22（Asia/Shanghai）。

本文保留当时的架构、问题、社区数据及排期判断，作为历史快照；其中的旧构建流程和已修复问题不代表当前实现。当前任务状态见 [roadmap](../roadmap.md)，实际实现与验证见 [2026 年 10 月实施记录](../iterations/2026-10.md)。再次评估上游时应重新查询，并记录日期及比较提交。

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
| 全屏资料库 | `library.js`（调研时入口，后于 ITER-022 D5 删除）、library.html、library.css | 项目图板、网页卡片、搜索、筛选、拖拽和批量处理 |
| 浏览器侧栏 | `sidepanel.js`（历史入口，E4 已移除）、sidepanel.html、sidepanel.css | 当前页收集、阅读定位、轻量管理、缓存首屏与耗时诊断 |
| 设置 | [设置脚本（现位置）](../../wxt/entrypoints/settings/App.vue)、[设置页面](../../wxt/entrypoints/settings/index.html) | 外观、语言、快捷键诊断、导入导出、清空数据；初始根级设置文件已随 ITER-020 A 迁入 WXT 页面目录 |
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

## 调研来源

- [上游实时仓库元信息 API](https://api.github.com/repos/gaoyiiiii/LaterOn)、[贡献者 API](https://api.github.com/repos/gaoyiiiii/LaterOn/contributors)、[forks API](https://api.github.com/repos/gaoyiiiii/LaterOn/forks?per_page=100)。上述链接返回实时状态，本文表格分别保留 2026-10-20 与 2026-10-22 的快照。
- [全部 issues API（含 PR）](https://api.github.com/repos/gaoyiiiii/LaterOn/issues?state=all&per_page=100)、[全部 PR API](https://api.github.com/repos/gaoyiiiii/LaterOn/pulls?state=all&per_page=100)。2026-10-22 补查分别统计 issue 和 PR，并结合公开分支头比较，未将 PR 重复计入 issue 数。
- [上游提交基线](https://github.com/gaoyiiiii/LaterOn/tree/a1a531325e4237f94a74a626296261991b16b4e0)。
- [pasiooooo 完整比较](https://github.com/gaoyiiiii/LaterOn/compare/a1a531325e4237f94a74a626296261991b16b4e0...pasiooooo:d12e7293270a8822ffe54b0b54dae13cb5f1c9fa)。
- [pasiooooo README](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/README.md)、[CHANGELOG](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/CHANGELOG.md)。历史版本说明中的 1.2 秒同步、临时标签补抓已被后续版本替换，以本记录对应提交的实现为准。
- [同步实现](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/webdav-sync.js)、[合并核心](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/webdav-sync-core.js)。
- [网址导入](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/import-urls-background.js)、[补抓队列](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/import-metadata-background.js)。
- [标签范围选择](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/tab-batch-background.js)、[发布工作流](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/.github/workflows/release.yml)、[v1.67.4 Release](https://github.com/pasiooooo/LaterOn/releases/tag/v1.67.4)。
