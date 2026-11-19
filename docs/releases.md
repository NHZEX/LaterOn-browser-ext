# 最近一次本机发布

本文件只保留最近一次部署证据；扩展源码版本以 [manifest.json](../manifest.json) 为准，产品历史见 [CHANGELOG](../CHANGELOG.md)，待验收项统一见 [roadmap](roadmap.md#当前优先已发布版本验收)。

## StaySide 1.79.2 · 2026-11-20

- 构建源码为 `next` 分支提交 `de47220`，本地标签 `v1.79.2` 指向该提交。产品变化见 CHANGELOG。
- 安装目录为 `D:/浏览器扩展/LaterOn`。固定公钥与部署前一致。
- 安装包为 `.output/release/StaySide-1.79.2.zip`，49 个文件，542,229 字节，未压缩 1,176,432 字节。同目录有 `.zip.sha256` 校验文件。
- ZIP SHA-256 为 `059d0c3632bdda02b27f1f83f849999d1e7a74418d919376c388bf0cf316c437`。`pnpm release:check` 和带版本标签的 `pnpm release:prepare` 通过。构建目录、ZIP 和安装目录的全部文件逐项校验一致。
- 旧安装备份位于 `D:/浏览器扩展/LaterOn-backups/1.79.1-2026-11-19T22-27-36-247Z-2bf927cd`，版本为 1.79.1。备份的 49 个扩展文件与部署前逐项校验一致。

本机发布复用本轮类型检查、备份专项和设置页浏览器回归。从安装目录在独立 Chromium 配置中加载后，已核对版本、本地文件入口、WebDAV 概况、连接设置折叠及按需加载远端列表。既有 Chrome 或 Edge 配置中的重新加载与验收见 roadmap。
