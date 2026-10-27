# 最近一次本机发布

本文件只保留最近一次部署证据；扩展源码版本以 [manifest.json](../manifest.json) 为准，产品历史见 [CHANGELOG](../CHANGELOG.md)，待验收项统一见 [roadmap](roadmap.md#当前优先已发布版本验收)。

## 1.70.5 · 2026-10-28

- 安装目录：`D:/浏览器扩展/LaterOn`。
- 产物：`.output/LaterOn-1.70.5.zip`，45 个文件，494,382 字节；未压缩 857,569 字节。
- ZIP SHA-256：`2b1a73178db89992efa4ee99988f4e74da57da7dfb75e7a99423cb3fba61e791`。构建目录、ZIP 和安装目录全部文件逐项一致；发布附件另整理至 `.output/release/`。
- 上版完整备份：`D:/浏览器扩展/LaterOn-backups/1.70.4-2026-10-27T17-18-55-903Z-22efe6d6`，44 个文件与部署前逐项 SHA-256 一致。
- 旧包无固定公钥，新包固定 ID 为 `bfipgmbngegmekjlnlphfamlhlmnmnbn`；首次迁移步骤见 [安装说明](../README.md#1-分钟安装)，用户数据迁移验收见 roadmap。目录备份仅包含扩展文件，不包含浏览器存储；本次未操作用户浏览器或卸载旧实例。
- 本次仅本机部署，未推送或创建 GitHub Release。

验证：新版本类型检查、81/81 Node 测试文件、工作流 actionlint、发布前后 ZIP 检查通过。发布整理测试使用真实临时 Git 仓库及 ZIP 验证提交范围、公钥、版本和独立校验文件。本轮业务源码未变，完整 Chromium 沿用本轮发版前 44/44 场景（无重试）及侧栏逆序 19/19 基线，没有因版本号更新重复执行全套。

实际安装目录另用全新临时 Chromium 配置加载，验证固定 ID、MV3 后台、收藏库、375px 侧栏、设置页、深色主题、独立启动 / 样式和编辑 / 取消；无页面错误或扩展资源加载失败。该烟测不代表用户既有配置、Edge 或原生侧栏外壳已验收。

本机证据位于忽略目录 `.output/` 的 `release-1.70.5-{typecheck,tests,publish}.log`、`release-1.70.5-{before,verification,smoke}.json`；完整浏览器与逆序基线分别见 `ci-browser.log`、`ci-panel-reverse.log`。这些文件不作为可在其他机器依赖的仓库文件。
