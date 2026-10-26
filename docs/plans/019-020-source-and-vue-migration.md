# ITER-019 / ITER-020：源码整理与 Vue 设置页迁移

记录日期：2026-10-22；更新日期：2026-10-23。已确认尝试 Vue + TypeScript + Reka UI，并先通过文件移动整理程序结构、将底层逻辑 TS 化和模块化。本文记录技术方向及分阶段实施边界。

状态：ITER-019 A–G 已完成、提交并通过本机验证。ITER-020 A 已提交为 `bf2f684`，B Vue 设置页已提交为 `d76f556`。以上迁移已随 `1.69.4` 发布至本机目录；正式扩展加载验收仍待完成。优先级与进度统一维护在 [roadmap](../roadmap.md)，执行结果见 [月度实施记录](../iterations/2026-10.md)。

## 现有边界与技术选择

- 当前 WXT 编译后台适配入口及设置页；其他旧页面及多数脚本通过资源清单复制。后台依赖 `importScripts`，旧页面依赖普通 `<script>` 和全局接口，部分测试直接读取并执行源码。移动文件需要同步处理加载路径、资源清单与测试引用。
- 采用 Vue + TypeScript + Reka UI 作为页面试点方向，继续复用现有 CSS 变量和视觉风格。Reka UI 提供无预设样式的交互组件及键盘、焦点管理基础，样式由项目维护，参见 [官方介绍](https://reka-ui.com/docs/overview/introduction)。本轮不同时引入 Tailwind 或调整整体视觉。
- 底层领域规则使用普通 TS 函数模块；Vue 组件负责界面，composable 负责响应式状态与业务接口的连接。公共类型随实际调用关系提取，避免提前建立复杂分层或通用组件体系。

## 建议实施顺序与提交边界

| 阶段 | 范围 | 完成条件 |
| --- | --- | --- |
| ITER-019 A：源码位置整理 | 将 `url-utils.js` 移至 `src/shared/url-utils.js`，同步测试和资源清单；构建仍输出根级 `url-utils.js` | 独立提交文件移动与路径修正，保持业务行为；已有测试和 WXT 构建通过 |
| ITER-019 B：纯逻辑 TS 试点 | 将 `src/shared/url-utils.js` 转为 TS 模块，明确参数、返回值及模块导出；按需提供新旧入口兼容适配 | 独立提交 TS 与模块接入；新旧调用方共用一份实现，URL 身份、TMS、查询编码、hash 路由等既有行为回归通过 |
| ITER-019 C：项目选择数据 TS 化 | 将 `modules/collection/picker.js` 迁至 `src/collection/picker.ts`，明确快照、请求及结果类型；接入 WXT 兼容入口 | 保持项目顺序、归档过滤、数量、封面优先级、语言和批次信息；纯模块、旧后台和构建产物回归通过 |
| ITER-019 D：备份核心 TS 化 | 将 `modules/backup/core.js` 迁至 `src/backup/core.ts`，导入值从 `unknown` 校验为明确类型；接入 WXT 兼容入口 | 保持备份格式、字段白名单、旧版 v2 兼容、关联校验与合并规则；导出、预览、合并及覆盖恢复回归通过 |
| ITER-019 E：标签导航 TS 化 | 将 `tab-navigation.js` 迁至 `src/tabs/navigation.ts`，明确查询选项与标签类型，显式导入共享 URL 规则；接入 WXT 兼容入口 | 保留 `LaterOnTabs` 和根级脚本路径；全屏与侧栏标签复用、TMS、hash 路由、排除标签和窗口聚焦回归通过 |
| ITER-019 F：存储层 TS 化 | 将后台协调器、客户端迁至 `src/storage/`，共享命令类型；客户端通信与界面副作用分开 | 保留存储键、消息协议、全局接口及共享队列；并发修改、失败重试、旧数据迁移、导入后代次失效与构建产物通信回归通过 |
| ITER-019 G：设置与主题 TS 化 | 将设置类型、默认值与存储接口迁至 `src/settings/`；主题 DOM 和系统媒体监听放入 WXT 兼容入口 | 保留 `LaterOnSettings`、根级 `theme.js`、四个页面的加载时序、旧单篇收藏启用标记和额外设置字段；设置读写与跨页主题同步回归通过 |
| ITER-020 A：设置页原生构建入口 | 将设置页接入 WXT 页面构建，复用现有功能 | 保留 `settings.html` 对外路径，验证资源、主题初始化及脚本加载；与 Vue 重写分开审查 |
| ITER-020 B：Vue 设置页 | 将表单与 DOM 操作逐步迁为 Vue + TS，按需使用 Reka UI；优先确认弹窗和开关 | 设置保存、主题、语言、快捷键信息、备份预览及导入导出行为保持一致；完成开发模式及 production 包验收 |

首批共享源码放入 `src/shared/`，A 阶段通过资源复制保留发布路径，B 阶段切换为 WXT 编译；其他模块位置与后续 TS 编译接入方式在相应阶段结合 WXT 配置确定。不一次性移动整个仓库，不仅为收纳根目录而批量建立 `legacy` 目录，其他文件按迁移单元逐步整理。

ITER-019 B 将 URL 实现转为 [TS 模块](../../src/shared/url-utils.ts)，直接导出四个函数和相关类型；[WXT unlisted script 入口](../../wxt/entrypoints/url-utils.ts) 仅将其接到 `globalThis.LaterOnUrl`，继续输出根级 `url-utils.js`。该文件退出复制清单，新代码可直接 import 同一实现。类型配置继承 WXT 生成配置，`pnpm typecheck` 独立执行，CI 同步检查；暂只纳入已迁移 TS 文件，旧 JS 测试不全量改写。CJS 测试通过统一 helper 在内存中使用 esbuild 编译实际兼容入口，保持 VM / DOM 隔离，并可独立运行；生产编译仍由 WXT / Vite 负责。入口及类型配置遵循 [WXT 脚本入口](https://wxt.dev/guide/essentials/entrypoints#unlisted-scripts) 与 [TypeScript 配置](https://wxt.dev/guide/essentials/config/typescript)。

ITER-019 C 延续单模块迁移，纯实现放在 [src/collection/picker.ts](../../src/collection/picker.ts)，当时的 WXT 兼容入口 `collection-picker.ts`（已在 F2 退役） 保留 `LaterOnPicker.buildPayload` 接口。产物采用 WXT 默认根级路径 `collection-picker.js`，后台同步更新 `importScripts`，原路径退出复制清单；不增加依赖。

ITER-019 D 将 [备份核心](../../src/backup/core.ts) 转为纯 TS 模块，明确收藏、项目、备份文档、存储快照与合并结果类型。导入入口接收 `unknown`，保留运行时白名单与关联校验；类型检查不代替数据校验。当时的 WXT 兼容入口 `backup-core.ts`（已在 F2 退役） 保留 `LaterOnBackup`，输出根级 `backup-core.js`，测试 helper 接入第三个编译入口。备份格式、消息协议和存储协调器的业务实现保持不变；存储客户端后续先梳理消息通信与界面职责。

ITER-019 E 将 [标签导航](../../src/tabs/navigation.ts) 迁为 TS 模块，通过 `wxt/browser` 访问带类型的扩展 API，并显式导入 URL 实现，取消对 `LaterOnUrl` 全局加载顺序的依赖。[WXT 兼容入口](../../wxt/entrypoints/tab-navigation.ts) 继续输出根级 `tab-navigation.js` 并保留 `LaterOnTabs`；旧页面引用不变，该脚本退出复制清单。迁移范围仅含网址比较、已有标签查询及激活，不增加事件监听或 DOM 操作。

ITER-019 F 将 [存储协调器](../../src/storage/coordinator.ts)、[客户端通信与代次管理](../../src/storage/client.ts) 和 [共享契约](../../src/storage/contracts.ts) 放入 `src/storage/`。WXT 分别输出根级 `storage-coordinator.js` 与 `storage-client.js`，旧后台和页面同步更新路径并保留 `LaterOnCollection` / `LaterOnStorage`。后台继续单队列读改写；消息从 `unknown` 经结构校验后进入业务操作。本机记录允许旧字段缺省，严格备份校验继续留在备份核心；客户端的提示、缓存清理和页面刷新放在 WXT 兼容入口，便于后续 Vue 复用通信逻辑。

ITER-019 G 将 [设置类型、默认值与纯规则](../../src/settings/shared.ts) 和 [存储读写、变更监听](../../src/settings/store.ts) 分开；设置页后续可直接导入存储模块。[WXT 兼容入口](../../wxt/entrypoints/theme.ts) 保留自动应用主题、系统深浅色监听及 `LaterOnSettings` 全局接口，继续输出根级 `theme.js`。原文件退出复制清单，HTML 的普通脚本与 defer 时序不变。保留 `get()` 的旧版单篇收藏 opt-in 规则；`watch()` 仍提供默认值叠加原始变更值，不套用该规则，因此回调保留原始存储边界的 `unknown` 字段类型。读写不删除其他页面保存的额外设置。

ITER-020 A 将设置页收纳到 [wxt/entrypoints/settings/](../../wxt/entrypoints/settings/index.html)：HTML 采用 [WXT 普通页面入口](https://wxt.dev/guide/essentials/entrypoints.html#unlisted-pages)，继续输出 `settings.html`，清单沿用 `options_page`。原设置 CSS 移至同目录 `style.css`；`main.js`（现由 B 阶段的 [main.ts](../../wxt/entrypoints/settings/main.ts) 与 Vue 组件接管） 保留原有 DOM 逻辑，直接导入设置 store，以及国际化、弹窗和备份交互脚本。Vite 编译页面模块与 CSS 依赖，输出到 `chunks/` 和 `assets/`；原设置 HTML、JS、CSS 及备份交互脚本退出复制清单。共享国际化、弹窗脚本与样式仍供其他旧页面使用，因此保留它们的经典产物；逐页迁移期间会有部分包体重复。

设置页仍在 `<head>` 使用经典 `theme.js` 提前应用主题，并用 `vite-ignore` 保留该独立构建脚本及公共图标的根级路径；国际化、弹窗和备份交互随页面模块在 DOM 解析后初始化。开发模式验证原生页面、模块依赖、样式及本地重载脚本可访问；production 产物回归执行实际编译模块图，覆盖中英文设置、主题同步、旧 opt-in、备份交互和导航。A 阶段保留 JS 与原生 DOM，与下述 B 阶段分开提交。

ITER-020 B 通过 [WXT 官方 Vue 模块](https://wxt.dev/guide/essentials/frontend-frameworks.html) 接入 `@wxt-dev/module-vue 1.0.3`、`Vue 3.5.44`、`Reka UI 2.11.0`。设置页改由 [App.vue](../../wxt/entrypoints/settings/App.vue) 管理表单及导航，[ShortcutsPanel.vue](../../wxt/entrypoints/settings/ShortcutsPanel.vue) 管理快捷键和诊断，[BackupPanel.vue](../../wxt/entrypoints/settings/BackupPanel.vue) 管理备份及清空操作。保留既有 CSS 和字典；国际化适配仅等待首轮语言读取，Vue 文本由模板渲染，语言切换仍保存后重载。共享经典主题脚本继续提前执行，其他旧页面不引入 Vue。

Reka UI 仅使用 Switch 和 Dialog，复用原开关及弹窗样式；普通按钮、下拉和数字输入仍用原生元素。页面自己的 [弹窗组件](../../wxt/entrypoints/settings/SettingsDialog.vue) 和 [composable](../../wxt/entrypoints/settings/useDialog.ts) 处理请求排队、取消、焦点约束与恢复；旧页面继续使用 `dialog.js`。新增 [备份通信接口](../../src/backup/client.ts)，保留消息名称、预览令牌和后台校验；旧 `modules/backup/settings.js` 被 Vue 组件替代。设置首次读取失败可重试，写入失败会提示，诊断轮询在组件卸载时清理。

类型检查改为 `wxt prepare && vue-tsc --noEmit`，包含 `.vue`。`vue-tsc 3.3.13` 仍依赖 TypeScript 的 JS 编译器入口，无法直接使用当前原生版 `TypeScript 7.0.2`，因此固定为兼容的 `6.0.3`，参见 [上游问题](https://github.com/vuejs/language-tools/issues/6124)。Node 24 与 pnpm 12 保持不变；以后升级 TS7 时需先验证 Vue Language Tools 的支持情况。

页面行为测试集中到 WXT 实际产物：JSDOM 执行编译后模块图，并与同一产物目录的备份后台通信；移除仅供旧 UI 使用的源码执行测试，不另造 SFC 编译器。类型检查、64/64 测试、production 构建、发布专项和 Vue 开发模块检查通过。Chrome 使用模拟扩展 API 验证空格切换开关、Tab / Shift+Tab 焦点约束、Escape 取消与焦点恢复、语言重载、主题及 375px 布局；这不代替正式加载扩展后的完整验收。

## 兼容、类型与验收要求

- URL 工具边界清楚但调用面广，迁移时保留已有行为用例；临时经典脚本或全局接口适配仅转接同一实现，调用方全部迁移后再移除。URL、项目选择数据、备份、标签导航与存储层分别迁移。
- 存储客户端按通信和界面职责拆分；迁移保留既有数据写入队列、存储键、合法消息行为与备份格式，畸形命令在运行时校验边界拒绝。
- 类型检查独立于构建：TS 模块纳入 TypeScript 检查，Vue 接入后增加 SFC 类型检查；WXT 构建成功不等同于类型检查通过。外部消息与导入数据仍需运行时校验。
- Reka UI 仅用于已迁移的 Vue 页面，旧页面继续使用原有组件；按真实复用需求形成少量公共组件，简单按钮和输入框可继续使用原生元素。
- 每阶段运行相应行为回归及构建检查；跨入口 URL 迁移需覆盖收藏、备份合并、阅读位置与标签复用等使用场景。页面迁移需验收深浅主题、中英文长文本、键盘操作、焦点恢复、设置重载及备份操作，并记录包体变化。
- production 验收关注实际行为和数据兼容，允许正常编译、分块和资源生成，不恢复旧源码与产物逐字节一致性的限制。阶段提交分别可审查、可回退，不混入新增产品功能。
- 设置页迁移稳定后，建议单独推进 ITER-008 的“关闭已读自动删除”；侧栏、收藏库与共享逻辑继续按维护收益渐进迁移，WebDAV 和 AI 归类另行评估。
