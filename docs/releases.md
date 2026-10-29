# 最近一次本机发布

本文件只保留最近一次部署证据；扩展源码版本以 [manifest.json](../manifest.json) 为准，产品历史见 [CHANGELOG](../CHANGELOG.md)，待验收项统一见 [roadmap](roadmap.md#当前优先已发布版本验收)。

## StaySide 1.71.0 · 2026-10-29

- 构建源码：`v1.71.0`，本次正式发布 StaySide 名称、琥珀橙图标与浅深色界面配色。
- 安装目录：`D:/浏览器扩展/LaterOn`。沿用既有加载目录，重新加载扩展后显示 StaySide 名称、新图标与统一配色。
- 产物：`.output/StaySide-1.71.0.zip`，46 个文件，419,461 字节；未压缩 786,396 字节。
- ZIP SHA-256：`671f43ad13d45a495b612fe5c25c8085a7213b7bdcdafd0c3bd36573817acb46`。构建目录、ZIP 和安装目录全部文件逐项一致；中英文名称、四个尺寸图标及封面占位资源核对通过。
- 上版完整备份：`D:/浏览器扩展/LaterOn-backups/1.70.6-2026-10-29T15-24-29-231Z-6fafcbc0`，46 个文件与部署前逐项 SHA-256 一致。
- 公钥与上版相同，固定 ID 为 `bfipgmbngegmekjlnlphfamlhlmnmnbn`，保留原存储键与备份协议。目录备份只包含扩展文件，不包含浏览器存储；本次未卸载扩展或操作用户既有浏览器配置。
- GitHub 正式安装包与独立 SHA-256 附件由 `v1.71.0` 标签触发既有工作流构建、验证和发布；本机 ZIP 的摘要仅适用于上述本机产物。

验证：本次仅将已验证的品牌与配色更新编为正式版本，类型检查、发布整理和本地 / 商店打包边界测试、侧栏逆序隔离 19 项通过，完成 ZIP 检查、安装目录逐文件校验和实际安装烟测。业务代码沿用同轮验证：Node 回归覆盖全部 81 个文件，其中 80 个全量通过，启动测试修正固定样式表数量的假设后单独重跑 19 项全部通过；44 项 Chromium 回归通过；22 项浅深色关键状态实测文字对比度最低约 4.52:1。侧栏回归增加实际颜色和资源加载断言，删除要求占位块必须使用渐变的重复源码断言，保留首字占位行为验证；其余存量测试按 ITER-021 随相关改动继续改进。

实际安装目录用全新临时 Chromium 配置加载，验证固定 ID、MV3 后台、StaySide 名称与图标、收藏库、375px 侧栏、设置页、深色英文界面，以及沿用原存储键的收藏读取、编辑与重新打开后的持久化；无页面错误或扩展资源加载失败。该烟测不代表用户既有配置、Edge 或原生侧栏外壳已验收，剩余范围仍见 roadmap。

本机发版证据位于忽略目录 `.output/` 的 `release-1.71.0-{typecheck,prepare-test,tools-test,panel-reverse,publish,smoke}.log`、`release-1.71.0-{verification,smoke}.json`；同轮界面回归与对比度证据见 `.output/brand/amber-{browser-tests.log,validation.json}`，安装截图见 `.output/brand/local-{library,sidebar-dark}.png`。这些文件不作为可在其他机器依赖的仓库文件。
