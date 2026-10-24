<p align="center">
  <img src="icon128.png" width="72" height="72" alt="LaterOn 图标" />
</p>

<h1 align="center">LaterOn</h1>

<p align="center"><strong>有价值的网页，留给 LaterOn。</strong></p>

<p align="center">
  <strong>LaterOn 是一款为项目研究而生的网页管理工具。</strong><br />
  把散乱的网页按项目收集、整理和持续处理。
</p>

![LaterOn 全屏项目管理与浏览器侧栏](docs/lateron-overview.webp)

## LaterOn 能做什么

| 一键添加 | 按项目整理 | 随时继续浏览 |
| --- | --- | --- |
| 按 `Alt+1` 添加当前网页，按 `Alt+Shift+1` 添加当前窗口的所有标签页。 | 添加时选择项目，或者先放进“等待整理”；支持拖拽和多选移动。 | 在全屏界面管理，在浏览器侧栏继续浏览；再次打开网页时可以继续上次滚动位置。 |

LaterOn 会自动提取网页标题、摘要、封面和来源。已经打开的网页不会重复创建标签页，而是直接切换到现有页面。YouTube 按视频 ID 识别同一视频，短链接、播放列表和播放时间参数的差异不会重复打开，也不会重置已打开视频的播放位置。

## 1 分钟安装

LaterOn 目前通过开发者模式安装，支持 Chrome / Edge 121 及以上版本。

1. [下载项目 ZIP](https://github.com/gaoyiiiii/LaterOn/archive/refs/heads/main.zip) 并解压。
2. 打开 `chrome://extensions/`；Edge 使用 `edge://extensions/`。
3. 开启右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择包含 `manifest.json` 的 `LaterOn-main` 文件夹。
5. 建议在扩展菜单中固定 LaterOn，点击图标即可打开侧栏。

## 日常使用

| 操作 | 方式 |
| --- | --- |
| 添加当前网页 | `Alt+1`，或网页右键菜单 |
| 添加当前窗口全部标签页 | `Alt+Shift+1` |
| 打开 LaterOn | 点击浏览器工具栏图标 |
| 搜索网页 | 地址栏输入 `lo`，按空格后输入关键词 |
| 在新标签页打开 | `⌘/Ctrl + 点击`文章卡片，或使用卡片右键菜单 |

快捷键可以在 `chrome://extensions/shortcuts` 中重新设置。

## 核心体验

- **等待整理**：没想好放在哪里时先添加，之后再统一归类。
- **全部项目首页**：用图板快速浏览所有项目，并直接新建项目。
- **侧栏继续浏览**：点击顶部“添加”将当前网页加入 LaterOn，已有网页显示“已添加”。切换浏览器标签页时，LaterOn 会自动定位到当前网页及其所属项目，并将横向项目栏中选中的项目滚入可视范围；阅读状态等数据刷新会保留当前选择的项目。
- **冻结网页收藏反馈**：收藏 The Marvellous Suspender 冻结页后，通过系统通知提示添加成功、已添加过、信息更新或失败；整窗收藏只发送最终结果。通知不可用时保留工具栏角标，普通网页继续显示页内提示。
- **项目归档**：归档项目会从普通项目列表和搜索中隐藏，可在全屏界面的“归档”中查看、搜索和恢复。归档中的已读网页仍按设置的期限自动清理；删除项目会同时永久删除其中的网页，操作前会确认。
- **阅读状态**：区分未读、在读和已读；已读内容默认 30 天后自动清理，可在设置中调整。
- **继续上次位置**：重新打开读过的网页时，由你决定是否回到上次滚动位置。
- **批量处理**：多选后可移动、标记、删除，或在一个新窗口中打开。批量删除会先确认，取消时保留勾选，确认后删除本次选中的网页，并一并清理上传封面。写入失败时保留原数据并提示重试。
- **中英文界面**：可以在设置中切换中文 / English。

## 开源协议

LaterOn 原创代码采用 [MIT License](LICENSE)，允许使用、修改、移植、再发布及商业使用；分发时须保留版权声明和协议全文。修改后的版本不强制开源，软件按现状提供，不作担保。

欢迎社区制作 Firefox 等浏览器的移植版本。请在衍生版本的说明中注明原项目与修改内容，清楚区分社区版本和官方版本；MIT 协议不授予品牌名称或 Logo 的商标使用权。

第三方内容仍由原权利人保有权利，适用其各自授权；例如 `tests/fixtures/` 中用于测试的外部网页内容，不因本仓库的 MIT 协议获得额外授权。

## 数据与隐私

- 网页、项目、阅读状态和设置保存在浏览器本地的 `chrome.storage.local` 中。
- 设置页支持导出 JSON 备份，包含网页、项目、顺序和阅读位置；默认不含图片数据，可勾选包含上传封面等图片数据。远程图片保留原链接，导入缺图时使用默认占位图；导入可选择合并或覆盖恢复，并先查看预览。本机主题、语言等设置不随备份覆盖。
- LaterOn 不要求注册账号，也不会把添加的网页上传到 LaterOn 服务器。
- 可以在设置页中清空全部本地网页数据。

## 常见问题

### 快捷键按下后没有反应

快捷键可能被系统或其他扩展占用。打开 `chrome://extensions/shortcuts`，为 LaterOn 换一个没有冲突的组合键。网页右键菜单不依赖快捷键，可以作为备用入口。

### 为什么有些页面不能添加？

Chrome 内部页面、扩展商店、浏览器内置 PDF 查看器等受保护页面不允许扩展注入内容。请切换到普通的 `http://` 或 `https://` 网页后再试。

### “加载已解压的扩展程序”提示找不到清单

请选择解压后直接包含 `manifest.json` 的文件夹，而不是它的上一级目录。

### 更新后界面没有变化

回到 `chrome://extensions/`，找到 LaterOn 并点击“重新加载”，然后重新打开侧栏或完整界面。

### 侧栏出现在左边，能改到右边吗？

可以。侧栏方向由浏览器控制，在 Chrome 的“设置 → 外观 → 侧栏”中修改。

## 项目开发

开发环境：Node.js 24、pnpm 12。具体版本见 [package.json](package.json)；Volta 按项目配置选择 Node.js 版本。

安装依赖：

```powershell
pnpm install --frozen-lockfile
```

运行 `pnpm build` 后，在浏览器中加载 `.output/chrome-mv3`；修改后重新构建并重新加载扩展。

| 命令 | 用途 |
| --- | --- |
| `pnpm test` | 运行 Node / JSDOM 测试 |
| `pnpm test:browser` | 构建后用真实 Chromium 验证首屏、布局和扩展持久化 |
| `pnpm typecheck` | 生成 WXT 类型配置并检查已迁移的 TypeScript 代码 |
| `pnpm build` | 使用 WXT 构建扩展到 `.output/chrome-mv3` |
| `pnpm zip` | 按默认 production 模式构建、打包，并按环境开关决定是否发布 |
| `pnpm zip --mode test` | 按 test 模式加载环境配置、打包并按开关发布 |
| `pnpm release:check` | 检查已有 ZIP 的 manifest、引用文件及开发文件混入 |

未设置发布开关时只打包。需要发布时，将 `.env.example` 复制为 `.env.<mode>.local`，启用发布并设置目录，例如：

```dotenv
# .env.test.local
LATERON_PUBLISH=true
LATERON_RELEASE_DIR=".output/LaterOn-test"
```

```dotenv
# .env.production.local
LATERON_PUBLISH=true
LATERON_RELEASE_DIR="D:/浏览器扩展/LaterOn"
```

环境由 WXT 的 `--mode` 选择，常用配置按 `.env` → `.env.local` → `.env.<mode>` → `.env.<mode>.local` 覆盖，系统环境变量优先。`.env`、`.env.local` 和 `.env.*.local` 均已忽略，仓库提供 `.env.example` 示例；相对目录以项目根目录为基准。仅当 `LATERON_PUBLISH` 为 `true` 时，打包完成钩子才执行部署，此时缺少目录会报错。

production 模式的产物为 `.output/chrome-mv3` 和 `.output/LaterOn-<版本>.zip`；test 模式为 `.output/chrome-mv3-test` 和 `.output/LaterOn-<版本>-test.zip`。默认 `pnpm zip` 使用 production 配置，因此本机 production 开关启用时也会部署；关闭开关即可只打包。`pnpm release:check` 检查默认 production ZIP。

扩展版本由 `manifest.json` 定义。发布前先运行测试；`pnpm build` 仅构建，即使发布开关开启也不部署。部署前检查 ZIP，安装目录的父目录须已存在，已有目录必须为同一扩展。旧版本保存在安装目录同级的 `<目录名>-backups/` 中，发布后需在浏览器中重新加载扩展。

浏览器测试首次运行前执行 `pnpm exec playwright install --no-shell chromium`（Linux CI 加上 `--with-deps`）。每个用例使用独立的临时浏览器资料目录，不读取日常浏览器数据；测试结果和失败截图在 `.output/browser-results`。已有构建可直接运行 `pnpm exec playwright test`。实现与分层边界见 [侧栏测试说明](tests/browser/README.md)。

GitHub Actions 在 Windows / Ubuntu 上执行依赖安装、Node / JSDOM 测试、侧栏用例逆序验证、构建和产物校验，再使用构建产物运行真实 Chromium 测试。

任务路线、迁移方案、调研和实施记录见 [项目文档](docs/README.md)。
