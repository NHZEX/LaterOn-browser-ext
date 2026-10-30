# 测试执行与边界

行为要求统一见 [AGENTS](../../AGENTS.md#测试约定)，命令定义以 [package.json](../../package.json)、远端步骤以 [CI 工作流](../../.github/workflows/ci.yml) 为准。本文不维护测试数量和逐轮通过记录。

## 执行

先按 [项目 README](../../README.md#项目开发) 安装依赖。

```powershell
pnpm typecheck
pnpm test
pnpm exec playwright install --no-shell chromium
pnpm test:browser
```

已有 production 构建时，可直接运行 `pnpm exec playwright test`。Linux CI 的浏览器安装加 `--with-deps`。Playwright 的构建目录与临时资料设置见 [extension.cjs](extension.cjs)，操作、场景及整套测试的超时、并发和重试策略见 [playwright.config.cjs](../../playwright.config.cjs)。失败截图、trace 与结果位于 `.output/browser-results`；使用 `pnpm exec playwright show-trace <trace.zip>` 查看失败前的操作、页面及网络记录，测试通过时丢弃 trace，不自动重试。

CI 为步骤及作业分别限制运行时间；浏览器测试的内部总超时早于步骤超时，给诊断上传留出时间。作业总超时、强制取消或 runner 中断仍可能阻止附件上传，不能依赖收尾步骤必定执行。具体上限以工作流为准。

侧栏调度隔离专项支持逆序：

```powershell
$env:PANEL_TEST_ORDER = 'reverse'
node --test tests/panel-fast-open.test.js
Remove-Item Env:PANEL_TEST_ORDER
```

## 分层与定位

| 层次 / 入口 | 验证范围 |
| --- | --- |
| `tests/*.test.js`，由 [test.cjs](../../scripts/test.cjs) 逐文件启动独立子进程 | 纯规则、实际模块、WXT 编译页面与存储行为；JSDOM 不负责真实布局、绘制或权限 |
| [panel-fast-open.test.js](../panel-fast-open.test.js) | 真实侧栏 / boot / 存储，虚拟时间与帧 / 空闲队列控制读取、缓存、广播和失败恢复；支持逆序 |
| [release-tools.test.js](../release-tools.test.js) | production / store / 自定义模式真实产物、页面 helper、ZIP 资源契约和隔离目录部署边界 |
| [prepare-release.test.js](../prepare-release.test.js) | 真实 ZIP 与临时 Git 仓库的版本 / 公钥策略、标签范围提交说明、校验和与原始字节交付；GitHub 上传和发布需远端验收 |
| [background.spec.cjs](background.spec.cjs) | 真实 MV3 后台、收藏、阅读位置、备份及浏览器重启 |
| [library.spec.cjs](library.spec.cjs)、[sidepanel.spec.cjs](sidepanel.spec.cjs) | 布局、键盘、菜单、编辑 / 批量 / 拖拽、同步及持久化；侧栏独立启动与 CSS 延迟 / 主脚本失败 |
| [picker.spec.cjs](picker.spec.cjs) | 网页浮层与独立选择页、样式隔离、重复打开、过期批次、确认 / 取消 |
| [ui-modules.spec.cjs](ui-modules.spec.cjs) | 国际化、引导、图片上传 / 焦点、编辑器按需加载与样式失败重试 |
| [storage-usage.spec.cjs](storage-usage.spec.cjs) | 设置页实际存储用量、内嵌图片分类、手动刷新、读取失败恢复及读取期间的数据变化 |
| [icon-storage.spec.cjs](icon-storage.spec.cjs) | 两页图标迁移、实际 PNG 显示及字节减量、无广播命令响应、初始化广播竞态、侧栏共享图标缓存，以及中英文图标详情的按需读取、分页、折叠丢弃迟到结果、预览、引用数、缺失提示和只读刷新 / 重试 |
| [content-injections.spec.cjs](content-injections.spec.cjs) | 元数据、阅读恢复及 MAIN world 翻译，网络 / Translator API 是可控外部边界 |

## 夹具边界

源码定位用 `tests/helpers/source-path.cjs`；`read-runtime.cjs` 执行实际构建入口，浏览器和发布专项读取 `.output`。不得把源码目录写进扩展 URL 或恢复退休资源的复制清单。

MV3 场景使用独立临时浏览器资料，执行真实扩展、后台、存储与消息；零依赖首屏场景另在网络边界扣住资源，只验证初始绘制。Node 场景按需控制浏览器 API、资源交付、存储失败 / 广播与调度，业务本身继续执行实际代码。验证自身写入后 UI 更新时显式关闭广播，避免依赖通知掩盖缺陷。

[icon-storage.test.js](../icon-storage.test.js) 执行真实后台队列、单篇 / 批量保存、迁移、删除与自动清理、备份协议，覆盖共享引用、失败重试及 worker 状态重建；[icon-cache.test.js](../icon-cache.test.js) 在存储和时间边界控制下验证缓存版本、图标子集与容量上限。图标夹具为合成内容，不提交用户导出文件。

这些自动化不代表原生侧栏外壳、系统通知展示、用户既有配置或 Edge 全部行为已验收。当前剩余验收只维护在 [roadmap](../../docs/roadmap.md#当前优先已发布版本验收)。
