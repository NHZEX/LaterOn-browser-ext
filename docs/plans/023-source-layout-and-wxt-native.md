# ITER-023：源码目录收拢与 WXT 原生化

更新日期：2026-10-27。F1 已提交 `ec7df23`，F2 已提交 `d72b546`，F3a 项目选择流程已实施，随本次提交；此前本机 `1.70.3` 的版本与发布记录已独立提交 `a716b05`。当前安装目录仍保持已发布内容，实施结果见 [月度记录](../iterations/2026-10.md)，优先级见 [roadmap](../roadmap.md)。

## 边界与阶段

WXT 已统一构建、打包和本机发布，设置页、收藏库及侧栏已使用原生页面入口和 Vue + TypeScript，后台及项目选择流程已使用原生模块依赖构建。其他网页注入脚本及部分公共界面仍通过复制清单发布；整个扩展原生化尚未完成，现有 JavaScript 的完整类型迁移也未一并扩大。

| 阶段 | 范围 | 状态 |
| --- | --- | --- |
| F1 | 源码按职责归位；静态资源使用 public；保持包内路径、经典脚本语义和业务行为 | 已提交 `ec7df23`、未发布；类型检查、79/79 测试文件、29/29 Chromium 场景及构建 / 发布校验通过 |
| F2 | 拆分后台职责，接入 WXT 原生模块依赖，退出 `background-runtime.js`、后台 `importScripts` 和全局桥接 | 已提交 `d72b546`、未发布；同步监听注册、共享写入队列和按需注入均保留，验证见下方 |
| F3 | 项目选择页接入原生页面构建，模块化弹窗、国际化与引导，收敛剩余复制清单 | F3a 项目选择流程已实施，随本次提交；其余公共设施后续迁移 |

## F1 目录与发布契约（阶段快照）

| 源码位置 | 职责 | 包内地址 |
| --- | --- | --- |
| `src/background/` | 经典后台主体及阅读位置后台 | `background-runtime.js`、`reading-position-background.js` |
| `src/backup/background.js` | 备份后台消息适配 | `modules/backup/background.js` |
| `src/content/` | 元数据、项目选择、阅读位置及翻译的网页注入脚本 | 原有 `content-*.js` |
| `src/picker/` | 共享项目选择 UI 与独立选择页 | `picker-ui.js`、`save-project-picker.html/js/css` |
| `src/ui/`、`src/shared/i18n-runtime.js` | 弹窗、引导、国际化经典实现 | `dialog.js`、`onboarding.js`、`i18n.js` |
| `src/sidepanel/boot.js` | 侧栏骨架、异步样式和启动兜底 | `boot.js` |
| `src/styles/` | 共享主题、弹窗、引导及翻译样式 | 原有独立 CSS；全屏 / 设置也继续通过 WXT 打包依赖 |
| `wxt/entrypoints/library/style.css`、`wxt/entrypoints/sidepanel/style.css` | 页面专属样式 | 全屏使用 WXT 编译样式；侧栏仍以 `sidepanel.css` 异步加载 |
| `wxt/public/` | 图标、占位图及 `_locales` | 原有根级资源路径 |

根目录保留项目文档、法律声明、依赖与配置。`LICENSE` 继续从根目录复制；`scripts/runtime-files.json` 用「包内路径 → 源码位置」显式表达剩余经典资源，不把业务源码堆入 public。测试通过 `tests/helpers/source-path.cjs` 解析源码位置，构建产物检查继续直接读取实际包内文件。

F1 移动 28 个文件，搬迁时逐一核对与提交前内容一致，保留有效注释；不改写数据、设置、消息协议或注入文件名。根目录普通文件从 42 个降为 17 个（包含本机忽略的环境配置）。旧 `dist/` 的 6 个 ZIP 和 2 张预览图完整归档至忽略目录 `.output/archives/dist-2026-10-26`，8 个文件 SHA-256 全部一致；该目录是本机历史归档，不进入安装包。

## 验收与后续

执行类型检查、全量 Node / JSDOM 测试、production / 自定义模式发布专项及真实 MV3 Chromium 回归。检查经典后台导入、按需注入、侧栏骨架与异步样式、主题 / 语言、弹窗和持久化；核对最终 ZIP 的资源契约及复制资源内容。F1 不部署到实际安装目录，用户重新加载验收及远端 CI 分别记录。

根目录原生弹窗禁用检查随源码迁移改为扫描 `src` 和入口脚本的 TypeScript AST，并通过符号区分局部命令与浏览器全局调用，避免目录迁移后扫描范围变空或误报同名业务方法。其他无关源码匹配断言继续按 ITER-021 渐进处理。

最终类型检查、79/79 测试文件、29/29 Chromium 场景（无重试）、构建及发布校验全部通过，三个预览生成脚本通过，209 个本地 Markdown 链接和 `git diff --check` 通过。测试 ZIP 为 51 个文件、543,823 字节，比已发布包减少 21,144 字节；public 图标移除了重复 hashed 图标产物。21 个复制文件及 7 个 public 资源的包内路径 / 内容与已安装版一致，实际安装目录未部署 F1。完整日志及范围见月度实施记录。

## F2 后台原生模块与资源退役

`wxt/entrypoints/background.js` 直接导入 `registerBackground`，同步注册消息、收藏命令、备份、阅读位置、通知、地址栏、菜单与清理监听。原 1,689 行后台主体拆为职责模块，`src/background/index.js` 收敛为 178 行入口与路由，最大模块 `save-workflow.js` 为 410 行；元数据、项目选择、持久化、通知、清理、导航、诊断与基础工具各自管理。保留场景说明和时限备注，将原来留在后台末尾的网页扫描性能说明移到 `src/content/metadata.js`。

保存、批量提交、项目命令、自动清理、备份导入 / 清空和阅读位置直接导入同一份 `src/storage/coordinator.ts`，移除独立回退队列。网页元数据、翻译、项目选择和阅读位置仍按需注入，不进入后台启动依赖图；冻结页与受保护页面继续使用原有降级路径。

包内移除 `background-runtime.js`、`reading-position-background.js`、`modules/backup/background.js`，同时删除已无消费者的 `storage-coordinator.js`、`backup-core.js`、`collection-picker.js` 三个全局桥接入口。后台不再安装 `LaterOnUrl` / `LaterOnCollection` / `LaterOnBackup` / `LaterOnPicker` 全局对象，也不再通过 `importScripts` 加载依赖。`url-utils.js` 仍供侧栏经典页面脚本使用；其余页面共享规则入口按实际消费者保留。

复制清单由 21 项降为 18 项。`scripts/runtime-files.json` 和 `scripts/build-assets.mjs` 暂时保留，F3 继续迁移项目选择页、弹窗 / 国际化 / 引导和样式等资源，逐项确认原生入口或按需注入构建的归属后再删除辅助文件，不将整张清单搬进 WXT 配置或把业务源码塞入 public。

ITER-021 本轮范围：后台集成测试在内存中编译实际 WXT 入口，模块行为测试执行真实导出及其依赖，去掉后台函数 / 常量源码切片和业务函数替身；元数据网页测试执行整个实际注入脚本。并发抓取通过 `chrome.scripting.executeScript` 边界控制等待，写入不发送存储广播；地址栏测试改为验证切页后不增加常驻角标。静态依赖边界使用 esbuild 模块图和 TypeScript AST，产物校验验证六个退休资源不再发布。无关页面存量源码匹配测试仍按 ITER-021 后续推进。

类型检查、79/79 Node / JSDOM 测试文件、31/31 Chromium 场景及构建 / 发布校验通过；新增真实 Chromium 冷启动及浏览器重启用例验证抓取保存、收藏命令、阅读位置、备份导出和跨重启预览令牌。最终测试 ZIP 为 45 个文件、523,340 字节，18 个复制资源和 7 个 public 资源逐项核对一致，206 个本地文档链接通过。首轮浏览器回归有一次 worker 启动超时，与 Node 重建产物目录并发，单独重跑完整回归全部通过，记录见月度记录。本轮未部署实际安装目录，随本次提交、未推送；远端 CI 和用户浏览器重新加载仍分别验收。

## F3a 项目选择流程原生化

独立选择页通过 `git mv` 从 `src/picker/index.html` 迁至 `wxt/entrypoints/save-project-picker/index.html`，模块入口导入页面初始化和样式，继续输出 `save-project-picker.html`。共享 `src/picker/ui.js` 显式导出 `openFolderPicker`，收藏库、独立页与网页浮层直接导入，移除 `window.openFolderPicker` 和产品预览全局入口；补充公共参数与返回值类型声明，未将整个 DOM 实现扩大为 TypeScript / Vue 重写。

`wxt/entrypoints/content-folder-picker.ts` 使用 unlisted script 打包共享面板及消息适配，后台只按需注入一个 `content-folder-picker.js`，不注册自动执行的 content script。保留 Shadow DOM、单次配置节点 / 就绪事件的双向握手、重复注入清理、失效 runtime 的同步 / 异步错误降级、主题与语言、冻结页回退、批次领取及确认后后台继续保存。有效注释随代码保留，旧全局和双文件加载说明改为当前模块语义。重复打开浮层时，旧宿主通过清理事件释放键盘、定位和媒体监听，防止旧批次响应当前操作。

复制清单从 18 项降至 13 项：选择页 HTML / JS / CSS、共享 UI 脚本与网页浮层脚本改由 WXT 构建。包内不再发布 `picker-ui.js`、`save-project-picker.js` 和 `save-project-picker.css`；稳定的 HTML 与注入 URL 保留。剩余 13 项仍包括其他网页注入、弹窗 / 国际化 / 引导、侧栏启动与样式和 LICENSE，两个构建辅助文件继续保留，后续逐项明确构建归属再退役。

ITER-021 本轮范围：浮层测试执行实际 WXT 注入产物，去掉函数源码切片、共享 UI 业务替身和相关样式源码匹配；重复注入通过真实 DOM、键盘、媒体和消息验证。独立选择页测试执行实际构建页面，并复用于 production / 自定义模式，覆盖确认、取消、新建、过期与失败恢复。预览也内联同一个真实注入 bundle；原有收藏库项目操作回归由页面模块自身加载选择器，不再人为预装全局脚本。

验证通过：类型检查、79/79 Node / JSDOM 文件、35/35 Chromium 场景（无重试）、production / 自定义模式构建与发布边界校验。新增四个浏览器场景覆盖中英文与深浅主题、站点 CSS 隔离、旧批次拒绝、重复打开后新建 / 收藏 / 取消、独立页关闭后的后台持久化和过期提示。测试 ZIP 为 47 个文件、525,497 字节；WXT 原生页面共享 chunk 和样式拆分使文件数比 F2 增加 2 个，ZIP 增加 2,157 字节。13 个复制文件及 7 个 public 文件与源码一致，三个旧选择器产物不存在。本轮随本次提交、未推送、未发布，实际安装目录仍为原 `1.70.3`；日志及产物核对见月度记录。
