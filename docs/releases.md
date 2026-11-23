# 最近一次本机发布

本文件只保留最近一次部署证据；扩展源码版本以 [manifest.json](../manifest.json) 为准，产品历史见 [CHANGELOG](../CHANGELOG.md)，待验收项统一见 [roadmap](roadmap.md#当前优先已发布版本验收)。

## StaySide 1.82.0 · 2026-11-23

- 构建源码为 `next` 分支提交 `0c8159a`，标签 `v1.82.0` 指向该提交。产品变化见 CHANGELOG。
- 安装目录为 `D:/浏览器扩展/LaterOn`。固定公钥与部署前一致。
- 安装包为 `.output/release/StaySide-1.82.0.zip`，49 个文件，569,131 字节，未压缩 1,264,203 字节。同目录有 `.zip.sha256` 校验文件。
- ZIP SHA-256 为 `bee8c4b21053e9147ae1caab052e6ff2e28207ef2db4dd918f3a88469e4da1b2`。`pnpm release:check` 和 `pnpm release:prepare --tag v1.82.0` 通过。构建目录、ZIP 和安装目录的全部文件逐项校验一致。
- 旧安装备份位于 `D:/浏览器扩展/LaterOn-backups/1.81.0-2026-11-23T07-16-36-125Z-1d1bf1fc`，版本为 1.81.0。备份的 49 个扩展文件与部署前逐项校验一致。

Discourse 功能提交通过类型检查、存储与阅读位置相关 Node 测试，以及侧栏和内容注入 Chromium 回归。部署只替换扩展安装文件；既有 Chrome 或 Edge 配置中的重新加载与验收见 roadmap。
