# StaySide 品牌资源

应用名为 **StaySide**。图标采用琥珀橙底、深色收纳槽与单张白色网页卡片，表达收集网页并按项目整理；以暖色和粗轮廓提高小尺寸菜单中的辨识度。

- [图标母版](stayside-icon.png)：用户确认的暖色简化版，使用内置 imagegen 生成；透明背景 PNG。
- [生成提示词](stayside-icon-prompt.txt)：记录母版的生成要求。
- 运行时图标为 `wxt/public/icon16.png`、`icon32.png`、`icon48.png`、`icon128.png`；由母版等比缩小，保留透明度，不另加文字、阴影或装饰。
- `wxt/public/article-cover-placeholder.png` 为同一母版的 512px 版本，供网页和项目缺少封面、当前网页缺少缩略图时使用。

四个尺寸同时更新，并检查 16px 工具栏尺寸在浅色和深色背景下的轮廓。母版不放入 `wxt/public`，避免作为未使用资源进入安装包。

界面强调色统一维护在 [accent-vars.css](../../src/styles/accent-vars.css)：亮琥珀按钮使用深色文字，浅深色主题分别提供文字和选中背景，红色与绿色分别用于危险操作和成功反馈。页面背景与正文颜色维护在 [theme-vars.css](../../src/styles/theme-vars.css)。
