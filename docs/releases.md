# 最近一次本机发布

本文件只保留最近一次部署证据；扩展源码版本以 [manifest.json](../manifest.json) 为准，产品历史见 [CHANGELOG](../CHANGELOG.md)，待验收项统一见 [roadmap](roadmap.md#当前优先已发布版本验收)。

## 1.70.4 · 2026-10-27

- 安装目录：`D:/浏览器扩展/LaterOn`。
- 产物：`.output/LaterOn-1.70.4.zip`，44 个文件，493,484 字节；未压缩 856,006 字节。
- ZIP SHA-256：`b149d23ce9fbc810a2af2dbf31e8d3893e792fe685faa51561dbb35d69589db6`。构建目录、ZIP 和安装目录全部文件逐项一致。
- 上版完整备份：`D:/浏览器扩展/LaterOn-backups/1.70.3-2026-10-27T12-21-20-144Z-4e3c2bb8`，52 个文件与部署前逐项 SHA-256 一致。权限、快捷键、图标、默认语言及最低 Chrome 版本未变。
- 包含 F1–F3d，业务代码截至 `a4782fd`；版本和发布文档已提交 `3057c62`。本次仅本机部署，未推送或创建 GitHub Release。

验证：新版本类型检查、80/80 Node 测试文件、发布前后 ZIP 检查通过。完整 Chromium 沿用 F3d 同一业务源码 44/44 场景（无重试）基线，没有在本次发版重复执行全套。

实际安装目录另用全新临时 Chromium 配置加载，验证 MV3 后台、收藏库、375px 侧栏、深色主题、独立启动 / 样式和编辑 / 取消；无页面错误或扩展资源加载失败。该烟测不代表用户既有配置、Edge 或原生侧栏外壳已验收。

本机证据位于忽略目录 `.output/` 的 `release-1.70.4-{typecheck,tests,publish}.log`、`release-1.70.4-{before,verification,smoke}.json`；不作为可在其他机器依赖的仓库文件。
