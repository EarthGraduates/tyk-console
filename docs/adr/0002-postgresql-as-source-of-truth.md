# ADR-0002: PostgreSQL 作为 API 定义的数据权威源

Tyk Gateway OSS 的 API 定义存储在 Redis 中，无持久化保证（docker-compose down 会丢失全部数据）。V1.1 引入 PostgreSQL 管理数据库后，决定将 PostgreSQL 升级为 API 定义的权威数据源（source of truth），Tyk 降级为纯运行时执行引擎。

## 决策

- 所有 CRUD 操作以 PostgreSQL 为起点
- 创建/编辑 API：先写 DB，再推送至 Tyk，更新 `sync_status`
- 停用 API：DB `status='inactive'`，Tyk DELETE，`sync_status='synced'`
- 重新启用：DB `status='active'`，Tyk POST，`sync_status='synced'`
- 删除 API：仅 DB 操作（前提：Tyk 中已不存在）
- 服务列表页从 PostgreSQL（PostgREST）读取，不再从 Tyk 读取

## 理由

1. **数据持久性**：PostgreSQL 有 volume 挂载（`./pgdata`），Redis 无 volume 挂载，docker-compose down 会导致 Tyk 全量数据丢失
2. **自管状态**：Tyk OSS 不支持 `active=false`，无法表达「停用但保留定义」，PostgreSQL 的 `status` 字段弥补了这一缺失
3. **单一真相源**：消除 Tyk 和 PostgreSQL 之间的状态不一致，避免页面出现矛盾信息
4. **变更追溯**：PostgreSQL 已有 `api_definition_log` 表，数据权威源在此才能保证日志完整

## 后果

- 数据层代码需重写：`getList` 从 PostgREST 读取，`create/update/deleteOne` 改为 DB 优先 + Tyk 推送
- `sync_status` 字段（`synced`/`pending`/`failed`）需实现追踪逻辑
- Tyk 不可用时，页面仍可展示 DB 数据，但推送操作会失败（需 UI 提示）
- 密钥管理暂时不受此决策影响（密钥仍以 Tyk 为主）

## 替代方案

- 单向 Tyk → DB 同步 → 被拒绝：Tyk Redis 数据不可靠，不能作为权威源
- 双向对比合并 → 被拒绝：冲突解决策略复杂，且 Tyk 数据本身不可靠
- 保持 V1.0 架构（Tyk 为权威源）→ 被拒绝：无法解决停用/持久化问题
