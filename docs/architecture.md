# 架构与代码入口

本文用于定位当前实现及理解边界；任务状态见 [roadmap](roadmap.md)，操作步骤见 [README](../README.md)。

## 入口与职责

| 职责 | 实现入口 |
| --- | --- |
| 构建、资源交付与 ZIP 后部署 | [wxt.config.mjs](../wxt.config.mjs)、[本机部署](../scripts/publish-local.mjs)、[包校验](../scripts/check-release.mjs) |
| MV3 后台与同步监听注册 | [WXT 入口](../wxt/entrypoints/background.ts) → [后台注册](../src/background/index.ts) |
| 收藏抓取、项目选择与保存 | [保存流程](../src/background/save-workflow.ts)、[单条保存](../src/background/collection.ts)、[项目选择](../src/background/project-picker.ts) |
| 收藏库、侧栏、设置页 | 各页的 [library](../wxt/entrypoints/library/main.ts)、[sidepanel](../wxt/entrypoints/sidepanel/main.ts)、[settings](../wxt/entrypoints/settings/main.ts) Vue 入口；页面业务位于 `src/library/`、`src/sidepanel/` |
| 独立项目选择页 | [页面入口](../wxt/entrypoints/save-project-picker/main.ts) → [选择器](../src/picker/main.js)，使用共享 DOM UI |
| 页面数据命令与共享队列 | [客户端](../src/storage/client.ts)、[协调器](../src/storage/coordinator.ts)、[契约](../src/storage/contracts.ts) |
| 备份导出、预览、恢复与清空 | [后台协议](../src/backup/background.ts)、[纯数据核心](../src/backup/core.ts)；语义见 [备份说明](backup-format.md) |
| URL 身份、标签复用与共享规则 | [URL](../src/shared/url-utils.ts)、[标签导航](../src/tabs/navigation.ts)、[筛选](../src/collection/filter.ts)、[排序](../src/shared/collection-sort.ts)、[编辑](../src/collection/item-edit.ts)、[阅读状态](../src/collection/item-state.ts) |
| 公共界面 | [国际化](../src/shared/i18n.ts)、[弹窗加载](../src/ui/load-dialog.ts)、[弹窗](../src/ui/dialog.js)、[引导](../src/ui/onboarding.js) |

## 数据边界

正式收藏数据位于 `chrome.storage.local`。页面通过客户端发送具体操作，后台在共享队列内读取最新数据并提交；编辑只带改动字段，移动只带目标和锚点，避免旧页面快照覆盖新数据。同一字段的并发编辑按后台处理顺序生效，后处理的值覆盖先处理的值；页面通过广播最终同步。封面内容与 `local://` 指针同批保存，删除项目按执行时的最新归属级联清理相关收藏及引用。

队列在 `src/storage/coordinator.ts` 定义。页面命令由协调器执行；保存、自动清理、阅读位置及备份也直接导入同一个 `enqueue`，各自在后台模块内提交存储。网络抓取与用户等待不占用收藏读改写队列。主题、语言等偏好和临时界面状态不属于这一收藏事务边界。

导入覆盖和清空更换收藏 epoch，使旧页面操作失效；备份提交原子更新关联数据，详见备份说明。页面响应还需处理自身写入没有存储广播的情形，测试约定见 AGENTS。

侧栏首屏缓存位于页面 `localStorage`，待确认收藏批次使用 `chrome.storage.session`；二者都不替代正式收藏数据。缓存、诊断和界面状态不进入收藏备份。

## 构建与保留的边界

| 决定 | 原因与维护要求 |
| --- | --- |
| 页面采用 Vue + TypeScript，领域规则用普通函数模块 | 组件管理界面，composable 连接状态与业务；Reka UI 按实际交互需要使用，简单按钮和输入保留原生元素，复用现有样式 |
| 运行脚本和样式通过 WXT 入口或资源依赖构建 | 仓库根目录不能直接作为扩展加载；旧复制清单和辅助复制脚本已删除，业务源码不放进 public |
| 网页脚本按需注入，保持现有 `content-*.js` 地址 | [元数据](../wxt/entrypoints/content-metadata.ts)、[阅读位置](../wxt/entrypoints/content-reading-position.ts)、[翻译](../wxt/entrypoints/content-translation.ts)、[项目浮层](../wxt/entrypoints/content-folder-picker.ts) 为 unlisted 入口，不自动匹配网页，也不进入后台冷启动依赖图 |
| 侧栏启动独立于主页面 | [boot 入口](../wxt/entrypoints/boot.ts) → [启动逻辑](../src/sidepanel/boot.js)，保留骨架、慢打开提示和十二秒兜底；[侧栏 HTML](../wxt/entrypoints/sidepanel/index.html) 的首屏样式非阻塞加载，主脚本失败也能执行启动兜底 |
| 弹窗脚本与样式按需加载且失败可重试 | 保持首屏轻量；构建生成资源 URL，不能重新写死退休的根级样式路径；`translation.css` 另用稳定独立入口供后台注入 |
| 保留必要的经典脚本桥接 | 原生构建已经覆盖资源归属，但不等于全量 ESM 或 TypeScript 改写；移除桥接前须核对消费者与首屏时序 |

仍在使用的桥接由 `wxt/entrypoints/` 中的 `theme.ts`、`storage-client.ts`、`tab-navigation.ts`、`url-utils.ts`、`item-edit.ts`、`item-state.ts`、`collection-filter.ts` 提供；`boot.ts` 保留小型启动接口。共享模块实现只有一份，桥接只负责暴露接口及页面适配。

静态图标、占位图和本地化清单由 `wxt/public/` 原样交付；根目录 LICENSE 是法律声明的唯一来源，WXT 配置单项声明其交付。实际安装资源以最终构建 / ZIP 为准。

TypeScript 曾因 `vue-tsc` 编译器入口兼容问题选择受支持版本。后续升级同时检查 Vue Language Tools 与 `pnpm typecheck`，依赖版本只维护在 package.json / lockfile 中。
