# 15：接入默认关闭的手动 WebDAV 同步试用

Status: ready-for-agent

ITER: ITER-007

**What to build:** 修补并回归后，在桌面 Chrome / Edge 普通构建提供明确选择开启的手动试用入口。试用不等于默认开启或正式支持所有 WebDAV 服务。

**Blocked by:** [12：同步项目级联删除，暂停已读自动清理](12-sync-project-deletes-and-pause-auto-clean.md)、[13：保留未绑定期间的手写修订](13-preserve-unbound-manual-revisions.md)、[14：纯接收不重复上传，补齐新收藏默认字段](14-sync-without-echo-and-complete-collection-defaults.md)。

- [ ] 默认关闭，无同步请求；显式开启后才可创建或加入同步收藏库并手动同步，不引入轮询或自动同步。关闭后不发起新的同步请求，独立 ZIP 备份与恢复不变。
- [ ] 用户显式指定专用同步目录，不默认沿用 ZIP 备份目录。创建必须使用空目录，加入须核对库身份并预览。拒绝把现有备份目录用作同步目录，不就地迁移旧协议。
- [ ] 开放试用前通过两套隔离浏览器配置的真实扩展回归。拟试用入口按[现行门槛](../../../docs/adr/0005-publish-immutable-webdav-sync-records.md#启用约束)只验证一次「发布 → 全新配置接入 → 核对代次和新增收藏」；未测或未通过的入口不开放试用，不重复跑完整服务回归。
- [ ] 观察扩展实际发出的同步 `PROPFIND` / `GET` 请求，确认缓存请求头后再决定是否需要补头；设置说明提醒关闭 OpenList 同步目录缓存，并保留独立 ZIP 全量备份。

**不在本票范围：** 仅凭文件名猜测归属来批量清理未确认的远端残留；残留清理不阻塞试用。
