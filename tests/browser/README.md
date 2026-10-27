# 侧栏与收藏库测试

源码读取与发布资源路径分离：`tests/helpers/source-path.cjs` 根据经典资源映射和 `wxt/public` 定位源码，`read-runtime.cjs` 继续编译实际兼容入口；浏览器和发布专项直接读取 `.output` 产物。不得将源码移动后的目录名替换到扩展 URL 或注入脚本名中。

`tests/panel-fast-open.test.js` 使用 Node test runner、JSDOM 和真实的侧栏、启动、弹窗及存储协调器代码。每个场景新建并关闭页面，独立复制存储和缓存；存储按请求键返回克隆值。存储广播默认关闭，删除分别验证开启 / 关闭广播，以及写入失败后重试。

只控制外部边界：存储读取用 Promise 闸门，浏览器绘制帧和空闲任务逐轮放行，时间用 `@sinonjs/fake-timers` 推进。一般状态等待有调度轮数上限，真实时间上限仅防挂起，不作为产品性能指标；提示与兜底的时间语义用虚拟时间验证。缓存同步读取成本在 performance 边界计入，避免忙等。快照断言要求实际写出 12 条预览，空快照不能误通过。

```powershell
node --test tests/panel-fast-open.test.js
node --test --test-name-pattern="诊断才写入" tests/panel-fast-open.test.js
$env:PANEL_TEST_ORDER = 'reverse'
node --test tests/panel-fast-open.test.js
Remove-Item Env:PANEL_TEST_ORDER
```

`tests/browser/sidepanel.spec.cjs` 使用 Playwright 自带 Chromium，布局检查针对 `.output/chrome-mv3` 的真实产物：

- 首屏：以本地请求拦截提供构建 HTML，扣住外部 CSS/JS；验证骨架可见、正式内容不占位、提示隐藏及深浅色，并等待实际 first-contentful-paint。此场景只验证资源未到达时的绘制，不执行业务脚本。
- 正式页面：以临时资料目录加载实际 MV3 扩展和后台，不模拟 Chrome 存储或消息。验证异步样式生效、375px 横向卡片与 640px 纵向卡片的封面 / 占位铺满、图片位于占位上层、导航通栏及无水平溢出。
- 操作：从卡片删除入口经真实弹窗、后台协调器和 Chrome 存储完成删除，重新加载后确认收藏及封面持久删除、其他收藏保留。

`tests/library-cards.test.js` 执行实际编译的 Vue 页面与存储协调器。7 个场景覆盖只读列表投影、千条收藏首批 48 条及后续批次、过期任务取消、当前阅读定位、写入失败 / 重试、无自身存储广播的状态和项目更新、焦点、封面降级及外部更新时取消拖拽；调度由独立页面的虚拟时间和空闲队列控制。既有编辑、删除、搜索与选择测试也通过 `read-runtime.cjs` 使用真实编译页面。

`tests/browser/library.spec.cjs` 同样加载真实 MV3 扩展和后台：深浅主题、中英文、375px / 1440px 布局与键盘操作；读取图片策略、封面 / 占位尺寸和存储结果；实际测量拖拽让位及 DOM 顺序，并单独用鼠标发起原生拖拽；1920px 下验证网格铺满及出现滚动条时导航不横移。几何检查等待实际卡片入场动画结束，避免固定睡眠。

`tests/library-menus.test.js` 增加 6 个场景，检查只读菜单模型、首项聚焦、方向键 / Home / End、Escape 与关闭方式、过期帧、最新数据和语言、外部删除、项目写入失败后重试；自身存储广播关闭。浏览器检查另用原生 Enter、Tab / Shift+Tab、Shift+F10 验证激活与焦点顺序、菜单到弹窗的焦点移交、375px 定位、resize / 滚动关闭及真实存储外部更新。production 与自定义模式也检查实际编译菜单。

`tests/library-bulk.test.js` 增加 12 个实际编译页面场景，验证分批渲染前的完整全选、隐藏选择、状态 / 移动 / 删除的失败重试、挂起写入及重复提交、确认目标固定、同会话新增选择和旧会话回调、外部删除及浮层卸载清理。存储写入使用 Promise 闸门，自身广播关闭；新窗口只模拟外部 API。Chromium 另增深浅主题和中英文两条真实操作链，覆盖原生 Space 选择、Enter 批量阅读、焦点、项目移动、删除取消 / 确认与重载持久化、375px 工具栏布局。production / 自定义模式同时验证批量写入后的 UI 和存储结果。

```powershell
node --test tests/library-cards.test.js
node --test tests/library-menus.test.js
node --test tests/library-bulk.test.js
pnpm exec playwright install --no-shell chromium
pnpm test:browser
```

CI 在 Windows / Ubuntu 上复用打包后的目录运行 `pnpm exec playwright test`，不自动重试。JSDOM 不负责布局、像素绘制或扩展权限；这些浏览器检查也不代表已验证原生侧栏外壳、系统通知展示或 Edge 全部行为。

F3a 的 `picker.spec.cjs` 增加四个中英文 / 深浅主题场景，通过真实后台收藏消息验证单文件网页浮层、站点 CSS 隔离、重复打开、新建项目、旧批次拒绝、持久化及取消；独立 WXT 选择页验证主题、确认后关闭与过期提示。独立页的 JSDOM 行为验证由 `tests/helpers/verify-picker-page.cjs` 复用于 production 和自定义构建，浮层重复注入测试执行实际 WXT bundle，覆盖配置先到 / 后到、旧监听释放和失效 runtime。F3a 后本地完整 Node 回归 79/79 文件、Chromium 35/35 场景通过。

F3b 的 `ui-modules.spec.cjs` 增加五个真实扩展场景，检查两页退出旧全局 / 旧脚本、编辑器按需请求、原生图片上传与持久化、焦点恢复、首轮英文引导、存储通知切换中文、已读与强制重播；另在外部样式请求失败后验证保留数据、重试与取消删除。JSDOM 使用测试命名空间接收真实模块导出，资源交付 / 设置通知由浏览器边界夹具控制，不向产品恢复 UI 全局。`i18n-onboarding.test.js` 增补语言竞态、引导清理、当前 / 排队弹窗取消、并发 epoch 提示和读取前卸载；旧弹窗 CSS / 源码耦合断言删除，样式由真实浏览器行为覆盖。最终完整 Node 79/79 文件、Chromium 40/40 场景（无重试）及 8 个生命周期专项通过。

采用的工具能力见 [Playwright 扩展测试](https://playwright.dev/docs/chrome-extensions)、[测试隔离](https://playwright.dev/docs/browser-contexts)及 [fake-timers](https://github.com/sinonjs/fake-timers)。其余存量测试仍按 [ITER-021](../../docs/roadmap.md#测试改进的迭代方式iter-021) 渐进改造。
