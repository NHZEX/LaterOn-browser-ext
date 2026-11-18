# 议题跟踪

工程技能使用 `.scratch/` 下的 Markdown 工单。迭代范围、优先级和待验收状态由 [roadmap](../roadmap.md) 维护。规格或细票可从对应 `ITER` 条目链接进入。票据状态只在对应工单文件维护。

## 发布与读取

- 每项功能使用 `.scratch/<feature>/`，新规格写入 `spec.md`。已有规格可沿用原件和链接。
- 每张实施票据写入 `issues/<NN>-<slug>.md`，从 `01` 开始，先写阻塞其他票据的票据。
- 票据包含交付行为、验收条件和 `Blocked by` 引用。关联迭代时写入 `ITER` 编号。
- 用文件顶部的 `Status:` 记录票据状态。技能要求标记可实施时，写 `Status: ready-for-agent`。
- 获取票据时读取给定路径；给定编号时在对应功能的 `issues/` 下查找。讨论追加到 `## Comments`。

## Wayfinding operations

- 计划入口是 `.scratch/<effort>/map.md`，决策票据在同目录下的 `issues/` 中，按编号排序。
- 用 `Type:` 记录票据类型，用 `Blocked by:` 引用阻塞票据。选择依赖均已解决且尚未认领的第一张。
- 开始时写 `Status: claimed`。完成时在 `## Answer` 下记录结论，改为 `Status: resolved`，并在计划入口追加结论摘要和票据链接。
