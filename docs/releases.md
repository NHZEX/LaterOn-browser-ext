# 最近一次本机发布

本文件只保留最近一次部署证据；扩展源码版本以 [manifest.json](../manifest.json) 为准，产品历史见 [CHANGELOG](../CHANGELOG.md)，待验收项统一见 [roadmap](roadmap.md#当前优先已发布版本验收)。

## StaySide 1.79.0 · 2026-11-19（本机工作区构建）

- 构建源码为 `next` 分支在 `c4a1423` 基础上的工作区，包含 WebDAV 第一阶段和 1.79.0 版本更新。产品变化见 CHANGELOG。
- 安装目录为 `D:/浏览器扩展/LaterOn`。固定公钥与部署前的安装一致。用独立 Chromium 配置从该路径加载后，已核对扩展版本和 WebDAV 设置入口。
- 产物为 `.output/StaySide-1.79.0.zip`，47 个文件，456,403 字节，未压缩 940,248 字节。同目录有 `.zip.sha256` 校验文件。
- ZIP SHA-256 为 `bc13ce38c87acefa74bbff3510a1440b08f08c57da90016d9b375fe2931ad7cf`。`pnpm release:check` 通过，构建目录、ZIP 和安装目录的全部文件逐项校验一致。
- 旧安装备份位于 `D:/浏览器扩展/LaterOn-backups/1.77.0-2026-11-19T07-35-57-559Z-1a5e51ec`，版本为 1.77.0。备份的 47 个扩展文件与部署前的安装逐项校验一致。

本机发布复用了 WebDAV 实现阶段的验证，包括类型检查、89 个 Node 测试文件、7 项设置页浏览器回归，以及隔离 WebDAV 服务上的手动上传、自动轮转和跨配置恢复。既有 Chrome 或 Edge 配置中的重新加载与验收见 roadmap。
