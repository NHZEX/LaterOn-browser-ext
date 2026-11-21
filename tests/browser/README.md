# 测试执行与边界

行为要求统一见 [AGENTS](../../AGENTS.md#测试约定)，命令定义以 [package.json](../../package.json)、远端步骤以 [CI 工作流](../../.github/workflows/ci.yml) 为准。本文不维护测试数量和逐轮通过记录。

## 执行

先按 [项目 README](../../README.md#项目开发) 安装依赖。

按改动选择验证范围；已经通过的检查，仅在代码变化、失败或新的疑点影响其结论时重跑。

| 场景 | 本地验证范围 |
| --- | --- |
| 业务代码已验证，之后仅调整版本号或发布说明、创建 tag | 复用业务验证结果；版本变更后重新打包，执行 `pnpm release:check`，标签创建后执行 `pnpm release:prepare --tag v<版本>`；不重复 Node / 浏览器全量回归 |
| 修改局部功能 | 对应模块的 Node / 浏览器场景；需要检查跨入口基本可用性时运行 `pnpm test:browser:smoke` |
| 存储协议、共享运行时等广泛影响，或没有可复用的验证结果 | 完整回归；CI 保留完整 Node 和浏览器检查 |

快速冒烟入口从现有行为场景中用 `@smoke` 标记选择，覆盖后台抓取 / 保存 / 导出、收藏库、侧栏保存、图标迁移、设置面板及备份恢复；语言和主题选择代表组合，完整矩阵仍由全量测试执行。它会先构建，再用两个 worker 运行，仍为每项创建独立浏览器资料，不共享收藏或后台状态。为减少记录开销，冒烟默认关闭 trace，失败仍保留截图；诊断指定失败场景时，可用 `pnpm exec playwright test <文件> --grep <场景> --trace=on`。

```powershell
pnpm test:browser:smoke
```

### 首份 WebDAV 同步快照

普通构建不开放同步验收入口。隔离构建只连接本机环回 WebDAV。先用一个配置在预先建好的专用空目录创建库并发布首份快照，再用其他配置输入相同地址和设置页显示的库 ID，预览、确认加入并手动同步。不要使用备份目录、旧同步验收目录或真实服务。

专项测试使用隔离 Chromium 配置和环回 WebDAV 夹具，覆盖创建、加入、离线新增、本机关联回退、同库解绑重绑与本机恢复隔离，以及标题与摘要双向编辑、显式清空、旧表单与覆盖找回。删除验收覆盖确认期间收到的成员、乱序与回放、保留成员的本机关联、主动重收及删除传播后的本机找回。旧候选迁移由本机找回测试验证。

发布容错测试覆盖已落盘后超时、发布记录写入或回执失败、跨重启补写、快照缺失或损坏及发布期间的新编辑。夹具让已发出的第 7 代记录在重绑并确认第 8 代后落盘；两代记录同时可见，新配置预览和接入第 8 代，重启对端也不回退。发端只有回读匹配且目录可发现时才确认发布；环回结果不能代替真实入口的完整列举验收。

收敛后再次同步只列目录并读取每台设备所选的发布记录，不下载快照或写远端。清理按本机确认历史尽力保留最近两代，先删旧记录、再删快照；不猜测未知归属，删除失败可跨重启重试。所选发布记录或快照返回 `404` 时整轮最多重新发现一次，只接受严格更新的代次；显式分页、列举达限、缺少已知设备或已确认代次时不合并。

```powershell
pnpm exec wxt build --mode sync-acceptance
$env:STAYSIDE_SYNC_ACCEPTANCE = '1'
try { pnpm exec playwright test tests/browser/sync-create.spec.cjs tests/browser/edit-recovery.spec.cjs }
finally { Remove-Item Env:STAYSIDE_SYNC_ACCEPTANCE }
```

「记录环回 WebDAV 的千条快照」用合成收藏生成 `webdav-traffic.json`，存放在 `.output/browser-results/` 中对应测试的输出目录。报告记录 gzip 大小、夹具收到的 HTTP 请求与请求体、扩展计量的请求与上下行字节，以及断线和模拟 `429`。字节不含 HTTP 头和传输开销；断线时 Chromium 可能在同一次 `fetch` 内重发，夹具实收不能用扩展计量替代。该报告不代表真实服务的流量、限额或安全性。

下列命令用于完整验证，不作为每次提交或打 tag 的固定前置步骤：

```powershell
pnpm typecheck
pnpm test
pnpm exec playwright install --no-shell chromium
pnpm test:browser
```

已有 production 构建时，可直接运行 `pnpm exec playwright test`。Linux CI 的浏览器安装加 `--with-deps`。Playwright 的构建目录与临时资料设置见 [extension.cjs](extension.cjs)，操作、场景及整套测试的超时、并发和重试策略见 [playwright.config.cjs](../../playwright.config.cjs)。失败截图、trace 与结果位于 `.output/browser-results`；使用 `pnpm exec playwright show-trace <trace.zip>` 查看失败前的操作、页面及网络记录，测试通过时丢弃 trace，不自动重试。

每轮 Playwright 运行会先清空配置的结果目录；主动截图也使用测试自身的 `outputPath()`，不再散落到 `.output` 顶层或为每轮排查新增目录。重启场景的持久浏览器资料和发布测试的部署夹具使用系统临时目录，并在测试结束时清理；一次性排查文件与失败证据的保留要求见 [临时文件约定](../../AGENTS.md#临时文件与验证产物)。

CI 为步骤及作业分别限制运行时间；浏览器测试的内部总超时早于步骤超时，给诊断上传留出时间。作业总超时、强制取消或 runner 中断仍可能阻止附件上传，不能依赖收尾步骤必定执行。具体上限以工作流为准。

CI 浏览器全量回归使用两个 worker，逐项输出结果和耗时；每项仍使用独立浏览器资料。Node 入口当前逐文件串行运行，部分测试会重建同一个 WXT 输出目录，不能直接增加并发；后续需先隔离构建产物，并用虚拟时钟或条件等待替换旧场景的固定延时。

Node 公共运行入口按需编译，并在当前测试进程内缓存；不同进程的内存缓存互不共享。侧栏定位场景推进各页面的虚拟时钟，保留分批绘制、滚动补正与迟到消息的行为检查，并在结束时释放页面；批量保存场景在定时器之间保留 Promise 执行顺序，以虚拟时间验证确认回执、三秒超时降级、逐篇通知和顺序保存。发布工具仍执行完整的真实构建、打包与回滚检查。

[收藏并关闭](../save-and-close.test.js) 通过后台注册的真实右键事件入口触发，用虚拟时间核对写入、反馈及 800ms 后关闭的顺序；仅替换浏览器 API 边界，覆盖项目确认 / 取消、重复收藏、冻结页、失败、切换标签及导航保护。

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
| [save-feedback.spec.cjs](save-feedback.spec.cjs) | 真实侧栏保存后的主题卡片、高亮 / 停留颜色、网页样式隔离、重复收藏、定时清理、系统主题与减少动态效果 |
| [ui-modules.spec.cjs](ui-modules.spec.cjs) | 国际化、引导、图片上传 / 焦点、编辑器按需加载与样式失败重试 |
| [storage-usage.spec.cjs](storage-usage.spec.cjs) | 设置页实际存储用量、内嵌图片分类、手动刷新、读取失败恢复及读取期间的数据变化 |
| [settings-tabs.spec.cjs](settings-tabs.spec.cjs) | 中英文设置分层、键盘切换和面板链接、存储按需读取、诊断展开轮询 / 停止 / 迟到结果及重试，以及切换期间导入导出继续完成或失败重试、选项保留和操作锁 |
| [notification-permissions.spec.cjs](notification-permissions.spec.cjs) | 真实新安装的通知权限与中英文设置展示；在浏览器授权 / 通知 API 边界控制拒绝、授权、禁用、异常和迟到结果，验证点击 / 键盘操作、状态同步、手动测试、失败重试及后台发送诊断持久化。UI、运行时消息与后台发送逻辑保持真实；原生授权弹窗与系统通知展示仍需既有浏览器验收 |
| [icon-storage.spec.cjs](icon-storage.spec.cjs) | 两页图标迁移、实际 PNG 显示及字节减量、无广播命令响应、初始化广播竞态、侧栏共享图标缓存，以及中英文图标详情的按需读取、分页、折叠丢弃迟到结果、预览、引用数、缺失提示和只读刷新 / 重试 |
| [content-injections.spec.cjs](content-injections.spec.cjs) | 元数据、阅读恢复及 MAIN world 翻译，网络 / Translator API 是可控外部边界 |

## 夹具边界

源码定位用 `tests/helpers/source-path.cjs`；`read-runtime.cjs` 执行实际构建入口，浏览器和发布专项读取 `.output`。不得把源码目录写进扩展 URL 或恢复退休资源的复制清单。

MV3 场景使用独立临时浏览器资料，执行真实扩展、后台、存储与消息；零依赖首屏场景另在网络边界扣住资源，只验证初始绘制。Node 场景按需控制浏览器 API、资源交付、存储失败 / 广播与调度，业务本身继续执行实际代码。验证自身写入后 UI 更新时显式关闭广播，避免依赖通知掩盖缺陷。

[icon-storage.test.js](../icon-storage.test.js) 执行真实后台队列、单篇 / 批量保存、迁移、删除与自动清理、备份协议，覆盖共享引用、失败重试及 worker 状态重建；[icon-cache.test.js](../icon-cache.test.js) 在存储和时间边界控制下验证缓存版本、图标子集与容量上限。图标夹具为合成内容，不提交用户导出文件。

这些自动化不代表原生侧栏外壳、系统通知展示、用户既有配置或 Edge 全部行为已验收。当前剩余验收只维护在 [roadmap](../../docs/roadmap.md#当前优先已发布版本验收)。
