# 系统架构

> 日期：2026-06-13 | 版本：v2.0

---

## 一、架构总览

```
                       ┌──────────────────────────────────┐
                       │         Tyk Gateway (:8080)       │
                       │   36 个 API 定义，keyless 透传     │
                       │   listen_path: /api/ygt/mdrs/...  │
                       └──────────────┬───────────────────┘
                                      │
                       ┌──────────────▼───────────────────┐
                       │   Python FastAPI Services (:8000) │
                       │                                   │
                       │  ┌─────────────────────────────┐  │
                       │  │  Validation Engine           │  │
                       │  │  Regex → Domain → CrossField │  │
                       │  │  (Chain of Responsibility)   │  │
                       │  └───────────┬─────────────────┘  │
                       │              │                     │
                       │  ┌───────────▼─────────────────┐  │
                       │  │  Router                      │  │
                       │  │  简单 CRUD → PostgREST        │  │
                       │  │  复杂写入 → PG 函数            │  │
                       │  └──────┬────────────┬─────────┘  │
                       │         │            │             │
                       └─────────┼────────────┼─────────────┘
                                 │            │
              ┌──────────────────▼──┐  ┌──────▼──────────────┐
              │ PostgREST (:3001)   │  │ PG Functions (ichse) │
              │ 表直连 CRUD          │  │ 事务内主子表写入       │
              │ 自动生成 REST API    │  │ asyncpg 直连调用      │
              └──────────┬──────────┘  └──────┬──────────────┘
                         │                    │
              ┌──────────▼────────────────────▼──────────┐
              │         PostgreSQL (:5433)                │
              │  ┌──────────┐  ┌──────────────────────┐  │
              │  │ ichse    │  │ biz                   │  │
              │  │ 管理数据  │  │ 业务数据 (lab/img/...) │  │
              │  └──────────┘  └──────────────────────┘  │
              └──────────────────────────────────────────┘

  ┌──────────────────┐
  │  Redis (:6380)   │
  │  规则缓存 + 日志  │
  │  队列             │
  └──────────────────┘
```

---

## 二、各层职责

### Tyk Gateway (:8080)

- 36 个 API 定义，一一对应 `biz.interfaces` 中的接口
- listen_path 按原 URL 格式：`/api/ygt/mdrs/v1/lis-center/{direction}/{operation}`
- 当前 `keyless` 模式（开发阶段），后续接入 Tyk 认证
- 不做协议转换、不做校验，纯透传到 services

### Python FastAPI Services (:8000)

**核心服务，三件事：**

1. **校验** — Validation Engine 从 Redis 加载规则，链式执行 regex → domain → cross_field
2. **路由** — 根据 `biz.interfaces` 元数据决定转发目标
3. **日志** — 校验结果异步写 Redis 队列，定时批量刷 PG

**路由策略：**

| 操作类型 | 转发目标 | 原因 |
|---------|---------|------|
| 简单单表读写 | PostgREST 表 API | PostgREST 自动生成 CRUD，无需手写 |
| 复杂多表写入 | PG 函数 (asyncpg) | 事务内主子表写入，PostgREST 无法处理 |

### PostgREST (:3001)

- 扫描 `ichse` schema 的表/视图，**自动生成 REST API**
- 简单 CRUD 不需要写任何 PG 函数
- 视图已过滤 `is_valid = true`，逻辑删除对外透明
- 通过 `web_anon` 角色授权

### PostgreSQL (:5433)

- **ichse schema**：管理数据（users, api_definitions, api_keys, 日志）+ PostgREST 视图
- **biz schema**：业务数据（lab_* 表），按业务域前缀组织
- 共享表：`biz.interfaces`, `biz.interface_fields`, `biz.validation_rules`, `biz.validation_logs`
- PG 函数：仅负责复杂主子表写入和 JOIN 查询，不做校验

### Redis (:6380)

- **规则缓存**：`validation:rules` — services 启动时从 PG 加载，前端修改规则后 `/admin/refresh-rules` 刷新
- **日志队列**：`validation:logs` — 校验结果异步 push，定时批量刷 PG
- 重启不丢数据（RDB 持久化）

---

## 三、请求处理流程

### 简单 CRUD（字典上传/下载等）

```
请求 → Tyk → services
              ├─ 校验 (Redis → rules)
              ├─ 通过 → PostgREST POST/GET /{table}
              └─ 失败 → 400 + errors
              └─ 异步: log → Redis queue
```

### 复杂写入（报告上传等）

```
请求 → Tyk → services
              ├─ 校验 (Redis → rules)
              ├─ 通过 → asyncpg → SELECT ichse.func_name($1::json)
              │         └─ PG 函数内事务: INSERT 主表 → INSERT 子表1 → INSERT 子表2...
              └─ 失败 → 400 + errors
              └─ 异步: log → Redis queue
```

### 规则刷新

```
前端保存规则 → PostgREST → PG validation_rules 表
前端 POST /admin/refresh-rules → services → PG 全量加载 → Redis 更新
```

---

## 四、数据库表架构

详见 `docs/designs/database.md`。

核心原则：
- 共享表（interfaces/validation_rules 等）不加业务前缀
- 业务表按 `biz.{domain}_{table}` 命名
- 列名使用实体前缀：`pt_`（患者）、`sp_`（标本）、`req_`（开单）、`chk_`（审核）等
- `data` JSONB 列全部展开为实列或子表

---

## 五、接口契约

所有对外接口的 `interface_id`、URL、入参、出参格式由 `biz.interfaces` 及其关联的 `biz.interface_fields` 定义。

- 入参字段名：接口原始驼峰（`labOrg`, `patientName`, `doctAdviseNo`）
- 出参格式：`{"code": 200, "message": "success", "dataInfoList": [...]}`
- PG 函数内部做接口字段名 → DB 列名的映射
- 接口调用方不感知数据库 schema 变化

---

## 六、核心决策记录

| 决策 | 说明 | ADR |
|------|------|-----|
| PostgreSQL 是数据权威源 | Tyk Redis 是瞬时状态，PG 是持久真相 | [ADR-0002](adr/0002-postgresql-as-source-of-truth.md) |
| 删除 API 同时清理密钥 | 独占密钥 DELETE，共享密钥清 access_rights | [ADR-0003](adr/0003-delete-api-cleans-keys.md) |
| 停用操作不处理密钥 | 停用仅从 Tyk 移除路由，密钥保留 | [ADR-0001](adr/0001-api-deactivate-does-not-handle-keys.md) |
| 校验走独立中间层 | 不在 PG 也不在前端做校验 | — |
| 复杂写走 PG 函数 | 事务性保证主子表一致性 | — |
