# ITER-023：源码目录收拢与 WXT 原生化

更新日期：2026-10-26。用户已确认实施 F1；此前本机 `1.70.3` 的版本与发布记录已独立提交 `a716b05`。当前安装目录仍保持已发布内容，实施结果见 [月度记录](../iterations/2026-10.md)，优先级见 [roadmap](../roadmap.md)。

## 边界与阶段

WXT 已统一构建、打包和本机发布，设置页、收藏库及侧栏已使用原生页面入口和 Vue + TypeScript。后台仍由 WXT 包装入口加载经典运行脚本，项目选择页及部分公共界面仍通过复制清单发布；不能将 ITER-022 页面迁移完成等同于整个扩展原生化完成。

| 阶段 | 范围 | 状态 |
| --- | --- | --- |
| F1 | 源码按职责归位；静态资源使用 public；保持包内路径、经典脚本语义和业务行为 | 已实施；类型检查、79/79 测试文件、29/29 Chromium 场景及构建 / 发布校验通过；随本次提交、未发布 |
| F2 | 拆分后台职责，接入 WXT 原生模块依赖，逐步退出 `background-runtime.js`、`importScripts` 和全局桥接 | 待实施；保持同步监听注册、共享写入队列和按需注入 |
| F3 | 项目选择页接入原生页面构建，模块化弹窗、国际化与引导，收敛剩余复制清单 | 待实施；按真实复用需求迁移 |

## F1 目录与发布契约

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
