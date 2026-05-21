# ichse-asset-share-center

Tyk Gateway OSS API 管理平台。管理 API 定义和密钥，弥补 Tyk 社区版缺少持久化存储和自管状态的短板。

## Language

**API 定义 (API Definition)**:
Tyk Gateway 上的一个 API 路由配置，包括 listen_path、target_url、认证方式等。
_Avoid_: 服务、接口

**停用 (Deactivate)**:
从 Tyk Gateway DELETE API 定义，保留在 PostgreSQL 中（`status='inactive'`），可一键重新推送。
_Avoid_: 禁用、关闭、下线

**删除 (Delete)**:
从 PostgreSQL 永久删除 API 定义记录，不可恢复。
_Avoid_: 彻底删除、物理删除

**重新启用 (Re-activate)**:
将 PostgreSQL 中 `status='inactive'` 的 API 定义重新 POST 到 Tyk Gateway，恢复路由。
_Avoid_: 恢复、上线

**双写 (Dual-write)**:
对 Tyk 的每次操作（创建/更新/删除），同步写一份到 PostgreSQL 管理数据库。Tyk 操作是主流程，DB 写入失败不阻断主流程。
_Avoid_: 同步、镜像

**自管状态 (Self-managed Status)**:
PostgreSQL 中的 `status` 字段（`active` / `inactive` / `archived`），独立于 Tyk OSS 的 Redis 状态。
_Avoid_: 启用/禁用状态、运行状态

**sync_status**:
PostgreSQL 中标记 DB 与 Tyk 同步状态的字段（`synced` / `pending` / `failed`）。随 ADR-0002（DB 作为权威源）需实现追踪逻辑。

**数据权威源 (Source of Truth)**:
PostgreSQL 是 API 定义的主数据存储。Tyk 是运行时执行引擎。见 [ADR-0002](docs/adr/0002-postgresql-as-source-of-truth.md)。

**创建 (Create)**:
写入 PostgreSQL，不推送 Tyk。sync_status 初始为 `pending`。
_Avoid_: 添加、新建

**同步 (Sync)**:
将 PostgreSQL 中的 API 定义推送到 Tyk Gateway。可自动触发（正常时）或手动触发（Tyk 异常时）。
_Avoid_: 推送、部署、发布

## Relationships

- 一个 **API 定义** 在 Tyk 和 PostgreSQL 中各有一份数据
- **停用** 操作触发：Tyk DELETE + PostgreSQL `status='inactive'` + log 记录
- **删除** 操作只影响 PostgreSQL（前提是 Tyk 已无此 API）
- **删除** 同时清理 Tyk 中关联的密钥（独占密钥 DELETE，共享密钥清 access_rights，见 ADR-0003）
- **重新启用** 将 PostgreSQL 中的 inactive 定义推回 Tyk

## Flagged ambiguities

- "停用" 和 "删除" 在早期讨论中被混用 — 已解决：停用是 Tyk DELETE（可恢复），删除是 PostgreSQL DELETE（不可恢复）
- "状态" 一词曾同时指 Tyk health 状态和自管状态 — 已解决：运行状态（Tyk health）是瞬时指标，自管状态（PostgreSQL `status`）是管理意图
