# 上游候选功能调研摘要

历史来源：2026-10-20 / 22 的只读调研，未重新查询线上状态，也未运行这些 fork。这里只保留未排期方向的参考与接入限制；当前排期以 [roadmap](../roadmap.md) 为准。历史社区数字、旧架构与已修复缺陷已移除。

比较基线：[上游 `a1a531325e4237f94a74a626296261991b16b4e0`](https://github.com/gaoyiiiii/LaterOn/tree/a1a531325e4237f94a74a626296261991b16b4e0)。重新启动某项评估时，应重新确定比较提交与实际需求，不能把旧 fork 的行为直接当作当前产品承诺。

## 网址导入、标签收集与 WebDAV

参考 [pasiooooo 固定提交 `d12e7293270a8822ffe54b0b54dae13cb5f1c9fa`](https://github.com/pasiooooo/LaterOn/tree/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa)。

- **网址导入（ITER-005，已搁置）**：文本 / TXT 先写入收藏，再持久化队列补抓资料；不创建或抢占标签页，保留手动编辑。后台 HTML 不执行页面脚本，登录页和动态页面可能缺资料；任务恢复不等于失败项无限重试。接入须复用本项目 URL 规则、共享写队列及备份 epoch，而不是移植旧设置页直接读改写路径。参考 [导入](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/import-urls-background.js) 与 [资料队列](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/import-metadata-background.js)。
- **选中标签 / 标签组（ITER-006）**：先固定当前窗口的目标快照，再选项目；范围变化不应改变在途任务。fork 重用了翻译快捷键并删除翻译，本项目保留翻译，因此不能原样接入命令映射。参考 [批量范围](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/tab-batch-background.js)。
- **WebDAV（ITER-007）**：fork 上传完整 JSON，有每日备份、基线和删除标记，但 PUT 缺少 ETag 条件写入；回读不能阻止另一设备随后覆写，新设备也可能无法识别旧副本中已在远端删除的记录。需先设计并发及首次接入语义，不能把“设备顺序使用”当作双设备并发保障。凭据本地保存不等于加密；真实服务尚未验收。参考 [同步](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/webdav-sync.js) 与 [合并](https://github.com/pasiooooo/LaterOn/blob/d12e7293270a8822ffe54b0b54dae13cb5f1c9fa/webdav-sync-core.js)。

## 可选 AI 归类（ITER-015）

参考 [Hyacehila 固定提交 `bdea4343796f3b4729495560e6bfcfde5c323001`](https://github.com/Hyacehila/LaterOn/commit/bdea4343796f3b4729495560e6bfcfde5c323001)，对应历史 PR #6。

值得保留的方向：先收藏再归类，失败留在等待整理；不自动建项目，不批量重排历史收藏。应用结果前复核条目、项目和配置，尊重用户在途手动修改；未知结果的付费请求不自动重发。

接入前明确远程提取发送 URL、归类发送正文与项目定义的边界，以及敏感参数、密钥、失败记录和主动清理策略。旧实现密钥与任务记录本地未加密，失败记录可能保留简介，七天清理依赖后续入队；不能直接照搬。应沿用本项目队列与 epoch，覆盖导入、清空、删除、取消和重启恢复。历史作者报告未调用真实服务，不能据此判断分类准确率、费用或服务兼容性。

## 其他历史参考

- ITER-011：首次搜索项目定位，[PR #4](https://github.com/gaoyiiiii/LaterOn/pull/4)，历史分支头 `1ccbd155`；当前 Vue 页面应先复现再评估。
- ITER-012：本地 PDF，[Issue #2](https://github.com/gaoyiiiii/LaterOn/issues/2)；产品范围、权限和重新打开方式尚未确定。

完整原始调研可用 `git show 3057c62:docs/research/2026-10-20-baseline-and-upstream.md` 回溯。
