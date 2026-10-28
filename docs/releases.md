# 最近一次本机发布

本文件只保留最近一次部署证据；扩展源码版本以 [manifest.json](../manifest.json) 为准，产品历史见 [CHANGELOG](../CHANGELOG.md)，待验收项统一见 [roadmap](roadmap.md#当前优先已发布版本验收)。

## StaySide 1.70.6 本地测试构建 · 2026-10-29

- 构建源码：`d706cfd`（StaySide 品牌更新，采用用户确认的琥珀橙暖色图标，并统一浅深色界面的交互强调色）。沿用 manifest 版本 1.70.6，属于本地测试构建，与此前 GitHub `v1.70.6` 的 LaterOn 发布包不同；未移动标签或替换远端附件。
- 安装目录：`D:/浏览器扩展/LaterOn`。沿用既有加载目录，重新加载扩展后显示 StaySide 名称、新图标与统一配色。
- 产物：`.output/StaySide-1.70.6.zip`，46 个文件，419,461 字节；未压缩 786,396 字节。
- ZIP SHA-256：`4a73ce08ba4dee2dafddcbd88ef16d02cd8251139a716b778c9a25e6762b34be`。构建目录、ZIP 和安装目录全部文件逐项一致；中英文名称、四个尺寸图标及封面占位资源核对通过。
- 配色部署前完整备份：`D:/浏览器扩展/LaterOn-backups/1.70.6-2026-10-29T15-07-19-474Z-4583133f`，45 个文件与部署前逐项 SHA-256 一致。本轮配色调整前的可回退版本保存在 `D:/浏览器扩展/LaterOn-backups/1.70.6-2026-10-29T15-04-15-332Z-de2842a2`。最终提交重新构建后与已安装文件一致，发布器核对哈希后保留现有目录。
- 公钥与上版相同，固定 ID 为 `bfipgmbngegmekjlnlphfamlhlmnmnbn`，保留原存储键与备份协议。目录备份只包含扩展文件，不包含浏览器存储；本次未卸载扩展或操作用户既有浏览器配置。
- 本次仅本机部署，未创建新的 GitHub Release 或商店发布。

验证：共享配色覆盖收藏库、侧栏、设置、弹窗、引导与网页内项目选择器，危险与成功操作保留语义色；README 截图仍为 1360 × 880、WebP 质量 95。类型检查通过；Node 回归覆盖全部 81 个文件，其中 80 个全量通过，启动测试修正固定样式表数量的假设后单独重跑 19 项全部通过；44 项 Chromium 浏览器回归通过。22 项浅深色关键状态的实测文字对比度最低约 4.52:1，无扩展资源加载失败。侧栏回归增加实际颜色和资源加载断言，删除一条要求占位块必须使用渐变的重复源码断言，保留首字占位行为验证；其余存量测试按 ITER-021 随相关改动继续改进。完成重新构建、部署、ZIP 检查与实际安装目录烟测。

实际安装目录用全新临时 Chromium 配置加载，验证固定 ID、MV3 后台、StaySide 名称与图标、收藏库、375px 侧栏、设置页、深色英文界面，以及沿用原存储键的收藏读取、编辑与重新打开后的持久化；无页面错误或扩展资源加载失败。该烟测不代表用户既有配置、Edge 或原生侧栏外壳已验收，剩余范围仍见 roadmap。

本机证据位于忽略目录 `.output/brand/` 的 `local-deployment-publish.log`、`local-deployment-verification.json`、`local-deployment-smoke.json`、`amber-validation.json`、`amber-node-tests.log`、`amber-panel-fast-open.log`、`amber-browser-tests.log`，以及 `local-library.png`、`local-sidebar-dark.png`。这些文件不作为可在其他机器依赖的仓库文件。
