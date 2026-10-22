# ITER-019 / ITER-020：源码整理与 Vue 设置页迁移

记录日期：2026-10-22；更新日期：2026-10-23。已确认尝试 Vue + TypeScript + Reka UI，并先通过文件移动整理程序结构、将底层逻辑 TS 化和模块化。本文记录技术方向及分阶段实施边界。

状态：ITER-019 A、B、C 已完成并通过本机验证；C 尚未发布，B 尚未发布。后续 ITER-020 待实施。优先级与进度统一维护在 [roadmap](../roadmap.md)，执行结果见 [月度实施记录](../iterations/2026-10.md)。

## 现有边界与技术选择

- 当前 WXT 编译后台适配入口，旧页面及多数脚本通过资源清单复制；后台依赖 `importScripts`，页面依赖普通 `<script>` 和全局接口，部分测试直接读取并执行源码。移动文件需要同步处理加载路径、资源清单与测试引用。
- 采用 Vue + TypeScript + Reka UI 作为页面试点方向，继续复用现有 CSS 变量和视觉风格。Reka UI 提供无预设样式的交互组件及键盘、焦点管理基础，样式由项目维护，参见 [官方介绍](https://reka-ui.com/docs/overview/introduction)。本轮不同时引入 Tailwind 或调整整体视觉。
- 底层领域规则使用普通 TS 函数模块；Vue 组件负责界面，composable 负责响应式状态与业务接口的连接。公共类型随实际调用关系提取，避免提前建立复杂分层或通用组件体系。

## 建议实施顺序与提交边界

| 阶段 | 范围 | 完成条件 |
| --- | --- | --- |
| ITER-019 A：源码位置整理 | 将 `url-utils.js` 移至 `src/shared/url-utils.js`，同步测试和资源清单；构建仍输出根级 `url-utils.js` | 独立提交文件移动与路径修正，保持业务行为；已有测试和 WXT 构建通过 |
| ITER-019 B：纯逻辑 TS 试点 | 将 `src/shared/url-utils.js` 转为 TS 模块，明确参数、返回值及模块导出；按需提供新旧入口兼容适配 | 独立提交 TS 与模块接入；新旧调用方共用一份实现，URL 身份、TMS、查询编码、hash 路由等既有行为回归通过 |
| ITER-019 C：项目选择数据 TS 化 | 将 `modules/collection/picker.js` 迁至 `src/collection/picker.ts`，明确快照、请求及结果类型；接入 WXT 兼容入口 | 保持项目顺序、归档过滤、数量、封面优先级、语言和批次信息；纯模块、旧后台和构建产物回归通过 |
| ITER-020 A：设置页原生构建入口 | 将设置页接入 WXT 页面构建，复用现有功能 | 保留 `settings.html` 对外路径，验证资源、主题初始化及脚本加载；与 Vue 重写分开审查 |
| ITER-020 B：Vue 设置页 | 将表单与 DOM 操作逐步迁为 Vue + TS，按需使用 Reka UI；优先确认弹窗和开关 | 设置保存、主题、语言、快捷键信息、备份预览及导入导出行为保持一致；完成开发模式及 production 包验收 |

首批共享源码放入 `src/shared/`，A 阶段通过资源复制保留发布路径，B 阶段切换为 WXT 编译；其他模块位置与后续 TS 编译接入方式在相应阶段结合 WXT 配置确定。不一次性移动整个仓库，不仅为收纳根目录而批量建立 `legacy` 目录，其他文件按迁移单元逐步整理。

ITER-019 B 将 URL 实现转为 [TS 模块](../../src/shared/url-utils.ts)，直接导出四个函数和相关类型；[WXT unlisted script 入口](../../wxt/entrypoints/url-utils.ts) 仅将其接到 `globalThis.LaterOnUrl`，继续输出根级 `url-utils.js`。该文件退出复制清单，新代码可直接 import 同一实现。类型配置继承 WXT 生成配置，`pnpm typecheck` 独立执行，CI 同步检查；暂只纳入已迁移 TS 文件，旧 JS 测试不全量改写。CJS 测试通过统一 helper 在内存中使用 esbuild 编译实际兼容入口，保持 VM / DOM 隔离，并可独立运行；生产编译仍由 WXT / Vite 负责。入口及类型配置遵循 [WXT 脚本入口](https://wxt.dev/guide/essentials/entrypoints#unlisted-scripts) 与 [TypeScript 配置](https://wxt.dev/guide/essentials/config/typescript)。

ITER-019 C 延续单模块迁移，纯实现放在 [src/collection/picker.ts](../../src/collection/picker.ts)，[WXT 兼容入口](../../wxt/entrypoints/collection-picker.ts) 保留 `LaterOnPicker.buildPayload` 接口。产物采用 WXT 默认根级路径 `collection-picker.js`，后台同步更新 `importScripts`，原路径退出复制清单。测试 helper 扩展到两个编译入口；本轮不增加依赖。之后优先评估备份核心的 TS 迁移，再推进设置页；存储客户端先梳理消息通信与界面职责。

## 兼容、类型与验收要求

- URL 工具边界清楚但调用面广，迁移时保留已有行为用例；临时经典脚本或全局接口适配仅转接同一实现，调用方全部迁移后再移除。备份核心可作为后续 TS 候选，不在首轮同时迁移 URL、备份和存储协调器。
- `modules/storage/client.js` 当前混合消息请求、页面刷新与提示展示，后续按通信和界面职责拆分；首轮保留既有数据写入队列、存储键、消息行为与备份格式。
- 类型检查独立于构建：TS 模块纳入 TypeScript 检查，Vue 接入后增加 SFC 类型检查；WXT 构建成功不等同于类型检查通过。外部消息与导入数据仍需运行时校验。
- Reka UI 仅用于已迁移的 Vue 页面，旧页面继续使用原有组件；按真实复用需求形成少量公共组件，简单按钮和输入框可继续使用原生元素。
- 每阶段运行相应行为回归及构建检查；跨入口 URL 迁移需覆盖收藏、备份合并、阅读位置与标签复用等使用场景。页面迁移需验收深浅主题、中英文长文本、键盘操作、焦点恢复、设置重载及备份操作，并记录包体变化。
- production 验收关注实际行为和数据兼容，允许正常编译、分块和资源生成，不恢复旧源码与产物逐字节一致性的限制。阶段提交分别可审查、可回退，不混入新增产品功能。
- 设置页迁移稳定后，建议单独推进 ITER-008 的“关闭已读自动删除”；侧栏、收藏库与共享逻辑继续按维护收益渐进迁移，WebDAV 和 AI 归类另行评估。
