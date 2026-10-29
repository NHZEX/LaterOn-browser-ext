# 最近一次本机发布

本文件只保留最近一次部署证据；扩展源码版本以 [manifest.json](../manifest.json) 为准，产品历史见 [CHANGELOG](../CHANGELOG.md)，待验收项统一见 [roadmap](roadmap.md#当前优先已发布版本验收)。

## StaySide 1.71.0 · 存储占用测试构建 · 2026-10-30

- 构建源码：基于 `83e7889ba4875886439d56df4bc8be7adf854ea0` 加入存储占用功能，构建时使用 `next` 工作树源码。沿用 manifest 版本 `1.71.0`，本地测试包与 GitHub 上已发布的同版本安装包内容不同，以本次摘要区分。
- 安装目录：`D:/浏览器扩展/LaterOn`。在扩展管理页重新加载 StaySide 后，打开“设置 → 存储占用”测试。
- 产物：`.output/StaySide-1.71.0.zip`，46 个文件，421,319 字节；未压缩 792,252 字节。
- ZIP SHA-256：`774b53dfbeda2a115e26c000f4d429c4072d283063c6e6430cf04c7d84b34272`。构建目录、ZIP 和安装目录全部文件逐项 SHA-256 一致，中英文名称、图标及封面占位资源核对通过。
- 部署前完整备份：`D:/浏览器扩展/LaterOn-backups/1.71.0-2026-10-29T16-25-50-574Z-885d934c`，46 个文件与原安装目录逐项 SHA-256 一致。
- 公钥保持一致，固定 ID 为 `bfipgmbngegmekjlnlphfamlhlmnmnbn`，沿用原存储键与备份协议。目录备份只包含扩展文件，不包含浏览器存储；本次未卸载扩展或操作用户既有浏览器配置。

验证：类型检查、全部 82 个 Node 测试文件及新增 3 个 Chromium 存储占用场景通过。最终文案与样式调整后，重新通过相关 11 项 Node 检查、3 个浏览器场景与构建；浅色桌面及深色 375px 窄屏截图核对通过，新面板实测文字对比度最低约 8.56:1。新增行为测试执行实际统计规则及扩展页面，覆盖远程地址与内嵌图片分类、编码开销、只读刷新、读取失败恢复和读取期间的数据变化；存量测试按 ITER-021 随相关改动继续改进。

实际安装目录使用全新临时 Chromium 配置加载，验证固定 ID、MV3 后台、收藏库读取与编辑后重新打开持久化、设置页实际总用量、内嵌图片计数、数据变化提醒与只读刷新、375px 深色英文侧栏；无页面错误或扩展资源加载失败。该烟测不代表用户既有配置、Edge 或原生侧栏外壳已验收，剩余范围见 roadmap。图片压缩与去重按用户要求暂缓。

本次证据位于忽略目录 `.output/`：`storage-usage-{typecheck,build,regression,final-node,browser,local-publish,local-smoke}.log`、`storage-usage-local-verification.json`；安装烟测记录为 `.output/brand/local-deployment-smoke.json`，截图为 `.output/brand/local-storage-usage.png`。这些文件不作为其他机器可依赖的仓库文件。
