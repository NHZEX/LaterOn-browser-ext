# 最近一次本机发布

本文件只保留最近一次部署证据；扩展源码版本以 [manifest.json](../manifest.json) 为准，产品历史见 [CHANGELOG](../CHANGELOG.md)，待验收项统一见 [roadmap](roadmap.md#当前优先已发布版本验收)。

## StaySide 1.79.3 · 2026-11-20

- 构建源码为 `next` 分支提交 `ad91977`，本地标签 `v1.79.3` 指向该提交。产品变化见 CHANGELOG。
- 安装目录为 `D:/浏览器扩展/LaterOn`。固定公钥与部署前一致。
- 安装包为 `.output/release/StaySide-1.79.3.zip`，49 个文件，542,285 字节，未压缩 1,176,790 字节。同目录有 `.zip.sha256` 校验文件。
- ZIP SHA-256 为 `7de1ed56e7eed18208677734f165f12de58e452014302c50a57b179c1a9e10b1`。`pnpm release:check` 和带版本标签的 `pnpm release:prepare` 通过。构建目录、ZIP 和安装目录的全部文件逐项校验一致。
- 旧安装备份位于 `D:/浏览器扩展/LaterOn-backups/1.79.2-2026-11-19T22-34-20-137Z-8f103888`，版本为 1.79.2。备份的 49 个扩展文件与部署前逐项校验一致。

类型检查、构建后设置页测试、备份专项、发布准备和浏览器回归通过。从安装目录加载独立 Chromium 配置后，已核对设置页三个入口、备份页内容、刷新定位及维护页分组。既有 Chrome 或 Edge 配置中的重新加载与验收见 roadmap。
