# 侧栏测试

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

```powershell
pnpm exec playwright install --no-shell chromium
pnpm test:browser
```

CI 在 Windows / Ubuntu 上复用打包后的目录运行 `pnpm exec playwright test`，不自动重试。JSDOM 不负责布局、像素绘制或扩展权限；这些浏览器检查也不代表已验证原生侧栏外壳、系统通知展示或 Edge 全部行为。

采用的工具能力见 [Playwright 扩展测试](https://playwright.dev/docs/chrome-extensions)、[测试隔离](https://playwright.dev/docs/browser-contexts)及 [fake-timers](https://github.com/sinonjs/fake-timers)。其余存量测试仍按 [ITER-021](../../docs/roadmap.md#测试改进的迭代方式iter-021) 渐进改造。
