# 商店上架资料

本文维护 Chrome 网上应用店的详情文案、权限用途和通用提交说明；素材来源见下表。

## 资料归属

| 内容 | 唯一维护位置 |
| --- | --- |
| 商店截图、语言目录、展示顺序与素材来源 | [assets/store](../assets/store/README.md) |
| 品牌母版与图标导出规范 | [assets/brand](../assets/brand/README.md) |
| 可随包交付的图标 | [wxt/public](../wxt/public/)，商店图标使用其中的 `icon128.png` |
| 扩展名称与简短描述 | [中文本地化](../wxt/public/_locales/zh_CN/messages.json)、[英文本地化](../wxt/public/_locales/en/messages.json)；修改时在源文件维护 |
| 扩展版本与权限声明 | [manifest.json](../manifest.json)，提交时核对最终 ZIP 中的 manifest |
| 商店包的构建方式、输出位置与本地安装包差异 | [项目 README](../README.md#项目开发)；实现见 [WXT 配置](../wxt.config.mjs) |
| 商店长描述、权限解释与提交步骤 | 本文 |

`assets/store/` 保留可复用的展示图片及素材说明，`docs/` 保留文字资料；生成的上传 ZIP 放在 `.output/`。截图、文档和品牌母版不放入 `wxt/public/`，避免进入扩展安装包。截图对应版本及更新要求只维护在素材说明中。

## 商店详情文案

名称与简短描述取自上表的本地化清单。以下长描述按语言分别填写，功能范围保持一致；不宣传尚未实现的同步、AI 归类或本地 PDF 功能。

### 中文长描述

StaySide 是一款为项目研究而生的网页管理工具，把散乱的网页按项目收集、整理和持续处理。

研究一个主题、筹备一个项目或学习一项技能时，把有价值的网页留在 StaySide，在全屏收藏库中整理，在浏览器侧栏继续浏览。

- 快速收集：添加当前网页或当前窗口的全部标签页，自动提取标题、摘要、封面和来源；暂未分类的网页可以先放进“等待整理”。
- 按项目整理：用项目图板浏览研究资料，编辑网页信息，并通过拖拽或批量移动调整归属；完成的项目可以归档。
- 侧栏继续浏览：查看当前网页的收藏状态，在侧栏切换项目；打开收藏时优先切换到已有标签页。
- 管理阅读进度：区分未读、在读和已读，重新打开网页时可选择恢复上次滚动位置。已读内容默认 30 天后自动清理，可在设置中调整期限或关闭。
- 搜索与批量处理：搜索收藏，批量移动、标记阅读状态、删除，或在新窗口中打开所选网页。
- 本地备份：导出 JSON 备份，导入前预览并选择合并或覆盖恢复；可选择包含上传封面等图片数据。
- 中英文界面：在设置中切换中文和 English。

StaySide 不要求注册账号。收藏、项目、阅读位置和设置保存在浏览器本地。开启 WebDAV 备份或手动执行备份时，收藏库快照会传输到你配置的 HTTPS 服务。获取网页元数据和展示远程封面、网站图标时，可能访问对应网站或图片服务。

StaySide 基于开源项目 LaterOn 独立重构维护，使用独立名称和图标。

### English long description

StaySide is a web manager built for project research. Collect scattered pages into projects, organize them, and keep working through them.

Whether you are researching a topic, planning a project, or learning a skill, keep useful pages in StaySide. Organize them in the full-page collection and continue browsing from the browser side panel.

- Collect quickly: add the current page or all tabs in the current window, with automatic title, description, cover, and source extraction. Keep pages in the inbox until you are ready to organize them.
- Organize by project: browse project boards, edit page details, and move pages with drag and drop or bulk actions. Archive completed projects.
- Continue from the side panel: check whether the current page is saved and switch between projects. Opening a saved page reuses an existing tab when available.
- Track reading progress: mark pages as unread, reading, or read, and choose whether to restore your previous scroll position when reopening a page. Read pages are automatically removed after 30 days by default; change the interval or turn off cleanup in settings.
- Search and work in bulk: search saved pages, move them, change reading status, delete them, or open selected pages in a new window.
- Back up locally: export a JSON backup and preview imports before merging or replacing collection data. Optionally include uploaded covers and other image data.
- Use Chinese or English: switch the interface language in settings.

No account is required. Collections, projects, reading positions, and settings are stored locally in your browser and are not uploaded to a StaySide server. Fetching page metadata and displaying remote covers or site icons may still contact the relevant websites or image services; local storage does not mean fully offline operation.

StaySide is independently maintained as a fork of the open-source LaterOn project, with its own name and icon.

## 单一用途与权限说明

单一用途描述建议填写：

> Help users collect, organize, and revisit web pages for project research through a local project collection and browser side panel.

下表为当前实现的英文权限解释，可用于商店后台填写；权限名称以实际上传包为准。官方要求按用途解释所请求的权限，见 [隐私字段说明](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)。

| 权限 | 用途说明 |
| --- | --- |
| `activeTab` | Access the page the user invokes StaySide on, so the extension can collect its metadata and display the project picker or save feedback. |
| `tabs` | Read tab URLs and titles to collect the current window's tabs, identify already-open saved pages, and keep the side panel aligned with the active page. |
| `scripting` | Inject packaged scripts for page metadata extraction, the project picker, saved-page scroll restoration, and user-triggered translation. |
| `storage` | Store collections, projects, settings, reading positions, local diagnostics, and temporary collection batches in the browser. |
| `unlimitedStorage` | Keep growing local collections, uploaded covers, site icons, and imported backups without the standard extension storage quota. |
| `alarms` | Schedule automatic cleanup and user-enabled WebDAV backups. |
| `sidePanel` | Display the collection alongside the current web page so users can organize and revisit project resources while browsing. |
| `contextMenus` | Provide commands to save the current page or the current window's tabs from the browser context menu. |
| `notifications`（可选） | Show save results for suspended pages when the user enables suspended-page notifications. Request permission from settings and revoke it when the user turns the option off. |
| `http://*/*`、`https://*/*` | Fetch metadata for saved pages, restore saved scroll positions, and connect to the HTTPS WebDAV service configured by the user for backups and restores. |

实现依据：[收藏流程](../src/background/save-workflow.ts)、[元数据回退](../src/background/metadata.ts)、[阅读位置](../src/background/reading-position.ts)、[标签复用](../src/tabs/navigation.ts)、[定时清理](../src/background/maintenance.ts)、[浏览器入口](../src/background/browser-setup.ts)、[通知设置](../wxt/entrypoints/settings/NotificationSetting.vue)。

## 数据处理与隐私披露依据

此处记录实现事实，供编写公开隐私政策和填写商店隐私表单使用，不替代完整隐私政策。不能因为数据保存在本地，就直接把所有数据类别选为“不收集”；应结合商店字段定义及实际处理行为填写，并与公开政策保持一致，见 [官方隐私字段说明](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)。

| 行为 | 当前边界与依据 |
| --- | --- |
| 收藏和项目 | 本地保存用户添加的网址、标题、摘要、来源、封面、项目与阅读状态；字段与写入边界见 [存储契约](../src/storage/contracts.ts) 和 [架构](architecture.md#数据边界)。 |
| 标签页与阅读位置 | 查询标签页 URL 以匹配收藏和复用已打开页面；已收藏页面保存滚动位置。见 [标签导航](../src/tabs/navigation.ts) 和 [阅读位置](../src/background/reading-position.ts)。 |
| 网页抓取 | 读取所添加页面的内容以提取元数据；必要时由后台重新请求该 URL，回退请求使用 `credentials: "omit"`。获取的 HTML 用于解析元数据。见 [页面提取](../src/content/metadata.ts) 和 [后台回退](../src/background/metadata.ts)。 |
| 远程图片 | 收藏中的远程封面、网站图标按链接展示，可能请求第三方网站或 CDN；本地上传的封面和共享内嵌图标保存在浏览器中。见 [卡片封面](../wxt/entrypoints/library/CardCover.vue) 和 [图标存储](../src/storage/icons.ts)。 |
| 翻译 | 用户触发后调用浏览器内置的 `Translator` / `LanguageDetector` API；浏览器可能需要下载模型。当前实现没有调用 StaySide 自建翻译服务。见 [翻译实现](../src/content/translation.ts)。 |
| 诊断 | 在本地记录快捷键、执行结果和错误等运行信息，供设置页排查。见 [诊断实现](../src/background/diagnostics.ts)。 |
| 备份与删除 | 由用户导出本地 JSON、预览导入或清空收藏；“清空”保留项目结构与设置，不等于清除所有扩展存储。已读清理受用户设置控制。见 [备份语义](backup-format.md) 和 [备份后台](../src/backup/background.ts)。 |
| WebDAV 备份 | 用户选择服务并发起手动备份或开启自动备份后，通过 HTTPS 传输收藏、项目、顺序、阅读位置及所选图片数据。凭据保存在设备上并用于服务认证，备份文件只包含收藏数据。见 [WebDAV 备份](backup-format.md#webdav-备份与恢复)。 |

远程网页 HTML 和图片的获取，应与远程代码执行区分。当前脚本由 WXT 构建，提交时仍须核对最终 ZIP 的脚本来源及依赖，再填写远程代码声明；不能仅凭“需要联网”作答。

公开隐私政策应说明上述数据如何获取、使用、保存、对外请求和删除，并提供真实的发布者身份、联系渠道与生效日期。发布者名称、支持地址、政策公开地址和商店条目 ID 由发布者确认；不以占位地址提交，也不把本机路径作为公开链接。

## 提交与后续维护

1. 按 [项目 README](../README.md#项目开发) 生成商店包，并按 [测试说明](../tests/browser/README.md#执行) 选择对应变更的验证范围。核对最终 ZIP 的版本、本地化、权限、图标及资源引用；商店包不含本地固定公钥，不能用普通安装包替代。
2. 对照 [素材说明](../assets/store/README.md) 核对截图与上传版本的界面、品牌和功能一致。中文与英文截图分别上传到对应语言；如需新增宣传图，在 `assets/store/` 维护，并在素材说明登记。
3. 按 [官方发布步骤](https://developer.chrome.com/docs/webstore/publish) 在开发者后台上传商店 ZIP。按 [商品详情说明](https://developer.chrome.com/docs/webstore/cws-dashboard-listing) 填写各语言长描述、截图和相关链接；名称及简短描述与包内本地化保持一致。
4. 按实际上传包填写单一用途、权限、远程代码和用户数据披露，填写可公开访问的隐私政策地址；分发地区、可见范围及发布时间由发布者决定。若提供 [审核测试说明](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions)，可使用下方操作示例，无需提供 StaySide 账号。
5. 发布者核对预览和披露内容后，在后台提交审核。后续版本更新时，重新核对资料与上传包的一致性。

审核操作示例：

> No StaySide account is required. Open a normal HTTPS page and use the extension's context menu to add it to StaySide. Choose or create a project, open the toolbar side panel, and expand the full-page collection. Confirm the saved page is present, edit its title, and reopen it. In Settings, switch to Data & Maintenance to export a JSON backup and preview an import. Notification permission is optional and is requested only when the user enables suspended-page notifications. Browser-protected pages cannot be saved.

商店政策和后台字段可能调整；实际提交时重新核对上述官方入口，不将本文件视为审核通过保证。
