# 架构与代码入口

本文用于定位当前实现及理解边界；任务状态见 [roadmap](roadmap.md)，操作步骤见 [README](../README.md)。

## 入口与职责

| 职责 | 实现入口 |
| --- | --- |
| 构建、资源交付与 ZIP 后部署 | [wxt.config.mjs](../wxt.config.mjs)、[本机部署](../scripts/publish-local.mjs)、[包校验](../scripts/check-release.mjs) |
| CI 产物与 GitHub 版本发布 | [工作流](../.github/workflows/ci.yml)、[发布文件整理与校验](../scripts/prepare-release.mjs)；按 Git 版本标签生成提交说明，保存普通安装 ZIP 及对应 `.zip.sha256`，独立发布作业复用同一产物 |
| MV3 后台与同步监听注册 | [WXT 入口](../wxt/entrypoints/background.ts) → [后台注册](../src/background/index.ts) |
| 收藏抓取、项目选择与保存 | [保存流程](../src/background/save-workflow.ts)、[单条保存](../src/background/collection.ts)、[项目选择](../src/background/project-picker.ts) |
| 收藏库、侧栏、设置页 | 各页的 [library](../wxt/entrypoints/library/main.ts)、[sidepanel](../wxt/entrypoints/sidepanel/main.ts)、[settings](../wxt/entrypoints/settings/main.ts) Vue 入口；页面业务位于 `src/library/`、`src/sidepanel/` |
| 独立项目选择页 | [页面入口](../wxt/entrypoints/save-project-picker/main.ts) → [选择器](../src/picker/main.ts)，使用共享 DOM UI |
| 页面数据命令与共享队列 | [客户端](../src/storage/client.ts)、[协调器](../src/storage/coordinator.ts)、[契约](../src/storage/contracts.ts) |
| 内嵌网站图标共享与回收 | [图标规则](../src/storage/icons.ts)；收藏写入统一经过协调器的 `commit` |
| 备份导出、预览、恢复与清空 | [后台协议](../src/backup/background.ts)、[纯数据核心](../src/backup/core.ts)；语义见 [备份说明](backup-format.md) |
| URL 身份、标签复用与共享规则 | [URL](../src/shared/url-utils.ts)、[标签导航](../src/tabs/navigation.ts)、[筛选](../src/collection/filter.ts)、[排序](../src/shared/collection-sort.ts)、[编辑](../src/collection/item-edit.ts)、[阅读状态](../src/collection/item-state.ts) |
| 公共界面 | [国际化](../src/shared/i18n.ts)、[弹窗加载](../src/ui/load-dialog.ts)、[弹窗](../src/ui/dialog.ts)、[引导](../src/ui/onboarding.ts) |
| 共享配色 | 页面入口共同加载 [强调色与状态色](../src/styles/accent-vars.css) 和 [主题表面](../src/styles/theme-vars.css)，侧栏将两者显式列为异步样式，避免原样发布的 CSS 依赖未打包的导入；[项目选择器](../src/picker/ui.ts) 将同一份强调色 CSS 内嵌到 Shadow DOM，浮层根节点独立定义变量，隔离宿主网页样式 |

## 数据边界

StaySide 是 LaterOn 的独立衍生版本。界面使用 StaySide 名称与图标；为兼容已有安装与备份，保留根 manifest 公钥、`laterOn*` 存储键、`lateron.collection` / 旧备份读取协议、经典脚本全局与注入消息标识，以及地址栏 `lo` 入口。部署环境变量继续使用 `LATERON_*`，现有本机配置无需迁移。图标母版与导出方式见 [品牌资源](../assets/brand/README.md)。

正式收藏数据位于 `chrome.storage.local`。页面通过客户端发送具体操作，后台在共享队列内读取最新数据并提交；编辑只带改动字段，移动只带目标和锚点，避免旧页面快照覆盖新数据。同一字段的并发编辑按后台处理顺序生效，后处理的值覆盖先处理的值；页面通过广播最终同步。封面内容与 `local://` 指针同批保存，删除项目按执行时的最新归属级联清理相关收藏及引用。

队列在 `src/storage/coordinator.ts` 定义。页面命令由协调器执行；保存、自动清理、阅读位置及备份也直接导入同一个 `enqueue`，各自在后台模块内提交存储。网络抓取与用户等待不占用收藏读改写队列。主题、语言等偏好和临时界面状态不属于这一收藏事务边界。

内嵌网站图标的完整 DataURL 按 UTF-8 内容计算 SHA-256，`laterOnIcons` 保存摘要到原图的映射，收藏 `favicon` 保存 `icon://<摘要>`。只合并完全相同的字符串，同站不同图分别保留；不解码、压缩、缩放或下载远程图标。普通 URL、空值及迁移失败后的旧内嵌值继续可用。共享表属于正式收藏数据，不是可淘汰缓存；独有图标会增加索引开销，收益取决于重复分布。

启动时幂等迁移图标，页面旧数据迁移和后续收藏写入也会归档内嵌图标。写入方在队列内读取最新列表与共享表，`commit` 将图标内容与引用同批保存；散列失败或已有摘要内容冲突时保留原始内嵌值，写入失败保留原快照供重试。迁移不更换收藏 epoch。删除、项目级联删除、自动清理、图标替换及导入均根据最终收藏重新整理共享表，最后一条引用消失后回收，不持久化引用计数。浏览器存储不额外假定提供数据库级事务。

导入覆盖和清空更换收藏 epoch，使旧页面操作失效；备份在单次存储调用中更新关联数据，详见备份说明。页面响应还需处理自身写入没有存储广播的情形，测试约定见 AGENTS。

侧栏首屏缓存位于页面 `localStorage`，版本化快照只保留最近十二条非归档收藏及被这些收藏引用的图标子集，同一图标在缓存内只保存一次；旧版本缓存丢弃重建。缓存首屏与完整列表读取并行，后续广播优先于旧读取结果。两页使用共享解析函数显示图标，命令响应携带图标表，发起页不依赖广播更新。待确认收藏批次使用 `chrome.storage.session`；二者都不替代正式收藏数据。缓存、诊断和界面状态不进入收藏备份。

设置页的存储占用总量由 `storage.local.getBytesInUse` 读取；分类按当前存储内容的 UTF-8 JSON 字节估算，内嵌图片包含编码开销，远程图片仅计地址，不代表浏览器缓存或实际磁盘大小。统计只在面板挂载及手动刷新时读取；本地存储变化仅提示刷新，不修改收藏或保存统计快照。

内嵌图标分类包含共享表原图及尚未迁移的内嵌值，每份实际存储内容只计一次；摘要索引、JSON 结构和收藏引用归入网页信息。使用内嵌图标的收藏数与实际保存图像份数分别展示，未被引用但尚存于共享表的内容也计入实际占用。

## 构建与保留的边界

| 决定 | 原因与维护要求 |
| --- | --- |
| 页面采用 Vue + TypeScript，领域规则用普通函数模块 | 组件管理界面，composable 连接状态与业务；Reka UI 按实际交互需要使用，简单按钮和输入保留原生元素，复用现有样式 |
| 运行脚本和样式通过 WXT 入口或资源依赖构建 | 仓库根目录不能直接作为扩展加载；旧复制清单和辅助复制脚本已删除，业务源码不放进 public |
| 网页脚本按需注入，保持现有 `content-*.js` 地址 | [元数据](../wxt/entrypoints/content-metadata.ts)、[阅读位置](../wxt/entrypoints/content-reading-position.ts)、[翻译](../wxt/entrypoints/content-translation.ts)、[项目浮层](../wxt/entrypoints/content-folder-picker.ts) 为 unlisted 入口，不自动匹配网页，也不进入后台冷启动依赖图 |
| 侧栏启动独立于主页面 | [boot 入口](../wxt/entrypoints/boot.ts) → [启动逻辑](../src/sidepanel/boot.ts)，保留骨架、慢打开提示和十二秒兜底；[侧栏 HTML](../wxt/entrypoints/sidepanel/index.html) 的首屏样式非阻塞加载，主脚本失败也能执行启动兜底 |
| 弹窗脚本与样式按需加载且失败可重试 | 保持首屏轻量；构建生成资源 URL，不能重新写死退休的根级样式路径；`translation.css` 另用稳定独立入口供后台注入 |
| 保留必要的经典脚本桥接 | 经典脚本消费者与首屏时序仍依赖这些接口；移除桥接前须核对消费者与加载顺序 |

仍在使用的桥接由 `wxt/entrypoints/` 中的 `theme.ts`、`storage-client.ts`、`tab-navigation.ts`、`url-utils.ts`、`item-edit.ts`、`item-state.ts`、`collection-filter.ts` 提供；`boot.ts` 保留小型启动接口。共享模块实现只有一份，桥接只负责暴露接口及页面适配。

`src/` 与 `wxt/entrypoints/` 的运行代码已全部使用 TypeScript（包括 Vue SFC）；原 JS 模块的配套 API 声明已合入 `.ts` 实现，`src/browser.d.ts` 只声明浏览器原生环境。构建配置、开发脚本与测试仍按各自工具保留 JS / MJS / CJS；包内输出的 `.js` 是构建产物。

静态图标、占位图和本地化清单由 `wxt/public/` 原样交付；根目录 LICENSE 是法律声明的唯一来源，WXT 配置单项声明其交付。实际安装资源以最终构建 / ZIP 为准。

TypeScript 曾因 `vue-tsc` 编译器入口兼容问题选择受支持版本。后续升级同时检查 Vue Language Tools 与 `pnpm typecheck`，依赖版本只维护在 package.json / lockfile 中。
