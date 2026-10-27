<p align="center">
  <img src="wxt/public/icon128.png" width="72" height="72" alt="LaterOn 图标" />
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

1. 从 GitHub Releases 下载 `LaterOn-<版本>.zip` 并解压（不要使用 GitHub 自动附带的 Source code）；从源码安装时，先按下方「项目开发」执行依赖安装及 `pnpm build`。
2. 打开 `chrome://extensions/`；Edge 使用 `edge://extensions/`。
3. 开启右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择安装包解压目录；从源码构建时选择 `.output/chrome-mv3`，不要选择仓库根目录。
5. 建议在扩展菜单中固定 LaterOn，点击图标即可打开侧栏。

本地安装包通过根 manifest 的固定公钥保持扩展 ID。更新时替换原安装目录中的文件并重新加载，不要先卸载扩展；卸载会清除该扩展的本地数据。从未配置固定公钥的旧版本首次迁移时，先在旧实例导出备份（需要保留上传图片时勾选图片数据），再在新实例导入并核对；确认恢复完成后再移除旧实例。本机主题、语言等设置需另行设置，不同浏览器或配置文件的数据也不会因 ID 相同而自动同步。

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

源码与扩展安装目录分离；根目录 `manifest.json` 是构建配置输入，不能直接加载仓库根目录作为扩展。

当前代码职责、WXT 入口及保留的经典脚本边界见 [架构与代码入口](docs/architecture.md)，依赖版本与脚本定义以 package.json 为准。

| 命令 | 用途 |
| --- | --- |
| `pnpm test` | 运行 Node / JSDOM 测试 |
| `pnpm test:browser` | 构建后用真实 Chromium 验证扩展界面、后台与持久化 |
| `pnpm typecheck` | 生成 WXT 类型配置并检查已迁移的 TypeScript 代码 |
| `pnpm build` | 使用 WXT 构建扩展到 `.output/chrome-mv3` |
| `pnpm zip` | 按默认 production 模式构建、打包，并按环境开关决定是否发布 |
| `pnpm zip --mode test` | 按 test 模式加载环境配置、打包并按开关发布 |
| `pnpm zip --mode store` | 构建商店上传包，移除 manifest 的 `key`，不执行本地部署 |
| `pnpm release:check` | 检查已有 ZIP 的 manifest、引用文件及开发文件混入 |
| `pnpm release:prepare` | 校验普通安装 ZIP，收集到 `.output/release`，生成对应 `.zip.sha256` 及当前版本发布说明 |

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

环境由 WXT 的 `--mode` 选择，常用配置按 `.env` → `.env.local` → `.env.<mode>` → `.env.<mode>.local` 覆盖，系统环境变量优先。`.env`、`.env.local` 和 `.env.*.local` 均已忽略，仓库提供 `.env.example` 示例；相对目录以项目根目录为基准。除 store 模式外，仅当 `LATERON_PUBLISH` 为 `true` 时，打包完成钩子才执行部署，此时缺少目录会报错；store 模式始终跳过本地部署。

production 模式的产物为 `.output/chrome-mv3` 和 `.output/LaterOn-<版本>.zip`；test 模式为 `.output/chrome-mv3-test` 和 `.output/LaterOn-<版本>-test.zip`。默认 `pnpm zip` 使用 production 配置，因此本机 production 开关启用时也会部署；关闭开关即可只打包。`pnpm release:check` 检查默认 production ZIP。

store 模式的产物为 `.output/chrome-mv3-store` 和 `.output/LaterOn-<版本>-store.zip`，构建时通过 WXT 的 manifest 配置函数省略 `key`，根 manifest 保持不变。GitHub 下载和本地加载使用普通 ZIP；上传 Chrome 商店使用 store ZIP，商店版本的 ID 由商店条目确定。该命令只生成上传包，不自动上传或发布到商店。

扩展版本由 `manifest.json` 定义。发布前先运行测试；`pnpm build` 仅构建，即使发布开关开启也不部署。部署前检查 ZIP，安装目录的父目录须已存在，已有目录必须为同一扩展。旧版本保存在安装目录同级的 `<目录名>-backups/` 中，发布后需在浏览器中重新加载扩展。

浏览器安装、测试执行与验证限制见 [测试说明](tests/browser/README.md)。CI 步骤以 [工作流](.github/workflows/ci.yml) 为准。

### GitHub 构建与发布

分支推送、PR 和手动运行使用 Ubuntu 执行类型检查、Node 测试及 Chromium 测试；通过后可在 Actions 的 Artifacts 下载 `lateron-<提交 SHA>`，保留 14 天。CI 强制关闭本机部署，不需要扩展私钥。涉及 Windows 路径或本机部署的改动，另在 Windows 运行相关测试。

正式发布时，先更新根 `manifest.json` 的版本并提交，再创建、推送同版本的 `v<版本>` 标签。标签必须与 manifest 版本完全一致并指向被构建的提交；所有检查通过后，工作流使用内置 `GITHUB_TOKEN` 创建 GitHub Release，上传普通安装 ZIP 及同名 `.zip.sha256`，最后公开草稿。发布作业直接使用本轮检查后的产物，不重新构建；只有该作业具有仓库写权限。CI 发布产物不提供商店包，商店模式可按需在本地构建。

本地运行 `pnpm zip` 后，用 `pnpm release:prepare` 预览当前提交；已有匹配标签时，可用 `pnpm release:prepare --tag v<版本>` 校验正式发布。该脚本只整理已有产物，不构建或部署；本机只打包时应设置 `LATERON_PUBLISH=false`。

发布说明由 Git 历史生成：选取当前提交之前最近的可达 `v<数字版本>` 标签，逐条列出此后提交的标题及短 SHA；CI 中附提交链接和完整 Compare 链接，再写入 `RELEASE_NOTES.md` 作为 Release 正文。没有先前版本标签时列出全部历史；当前提交上的标签、预发布标签及不在当前历史中的标签不作为基线。CI 获取完整历史与标签，浅克隆需先补全历史。首次启用时应将选定的基线标签一并推送到远端，确保本地和 CI 的比较起点一致。CHANGELOG 可继续维护面向用户的摘要，发布流程不读取它。

每份安装 ZIP 使用单独的 `LaterOn-<版本>.zip.sha256`，内容为 SHA-256 摘要及 ZIP 文件名。下载 ZIP 和校验文件到同一目录后，运行 `sha256sum --check LaterOn-<版本>.zip.sha256`；PowerShell 可运行 `Get-FileHash <ZIP路径> -Algorithm SHA256` 与校验文件核对。

`retention-days` 仅控制 Actions 临时产物的保留天数：当前构建包为 14 天，浏览器失败截图为 7 天，过期自动删除；不影响 GitHub Release 中的下载附件。

已经存在的同名 Release 不会被覆盖；中途失败可能留下草稿，检查并删除未发布草稿后再重跑失败作业。已公开版本应修复后使用新版本标签，不移动旧标签或替换其资产。远端首次运行及发布验收见 roadmap。

未完成任务、最近本机发布证据及历史回溯方法见 [项目文档](docs/README.md)。
