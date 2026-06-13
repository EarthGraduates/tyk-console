# API 管理模型 v2.0

> 日期：2026-06-13 | 状态：结论

---

## 一、核心概念

| 术语 | 存储 | 含义 | 页面 |
|------|------|------|------|
| **接口/服务** | `biz.interfaces` | 业务服务的元数据：接口 ID、URL、入参出参、分类、校验规则 | 接口管理 |
| **API** | `ichse.api_definitions` | Tyk 网关中的 API 定义：listen_path、target_url、认证模式、启停状态 | API 定义 |
| **API JSON** | 无 | 不再以文件形式存在。API 定义以 PG 为权威源，直接调 Tyk API 注册 | — |
| **密钥** | `ichse.api_keys` | Tyk 密钥元数据：key_id、access_rights、速率、配额 | 密钥管理 |

**接口 ≠ API**：接口描述业务服务，API 描述网关入口。一个接口可以通过一个或多个 API 暴露。

---

## 二、数据模型

```
biz.interfaces (服务元数据)
  ├── interface_id (PK, 如 LAB-NX-MD-O001)
  ├── func_name
  ├── url, http_method
  ├── biz_domain, category_code
  └── ...

ichse.api_definitions (API 定义，Tyk 权威源)
  ├── api_id (PK, 如 ichse-lab-nx-md-o001)
  ├── interface_id (可选 FK → biz.interfaces)
  ├── name, listen_path, target_url
  ├── auth_mode, status, sync_status
  ├── definition (完整 Tyk API JSON)
  └── ...

ichse.api_keys (密钥管理)
  ├── key_id (PK)
  ├── api_id (FK → api_definitions.api_id)
  ├── access_rights, rate, quota
  ├── status
  └── ...
```

---

## 三、页面合并

| 之前 | 之后 | 操作的表 | 功能 |
|------|------|---------|------|
| `/apis` (直连 Tyk) + `/api-records` (查 PG) | **/apis** — API 定义 | `ichse.api_definitions` | CRUD + 启停 + Tyk 状态查询 |
| (无) | **/interfaces** — 接口管理 | `biz.interfaces` | 查看 + 一键注册 API |
| `/keys` | **/keys** — 密钥管理 | `ichse.api_keys` + Tyk | CRUD + 同步调 Tyk |
| `/validation-rules` | 不变 | `biz.validation_rules` | CRUD |

**API 定义页面（合并后）逻辑：** 数据以 PG `api_definitions` 为主，同时调 Tyk API 查询实时状态（运行中/已下线/异常），作为状态辅助列展示。

---

## 四、操作流程

### API 注册

1. **一键注册**（从接口管理页发起）：
   - 选择 `biz.interfaces` 中的接口
   - 填写 listen_path、auth_mode、owner_id
   - INSERT `ichse.api_definitions` (status='active', sync_status='pending')
   - POST `/tyk/apis/` → Tyk 注册
   - UPDATE sync_status='synced', last_sync_at=now()

2. **手动注册**（从 API 定义页发起）：
   - 直接填写完整 API 定义表单
   - 同上 INSERT + POST Tyk

### API 启停

| 操作 | PG | Tyk |
|------|----|-----|
| 停用 | UPDATE status='inactive' | DELETE `/tyk/apis/{api_id}` |
| 重新启用 | UPDATE status='active' | POST `/tyk/apis/`（幂等覆盖） |
| 删除 | UPDATE status='archived' | DELETE `/tyk/apis/{api_id}` |

### 密钥管理

| 操作 | PG | Tyk |
|------|----|-----|
| 创建 | INSERT `api_keys` | POST `/tyk/keys/create` |
| 吊销 | UPDATE status='revoked' | DELETE `/tyk/keys/{key_id}` |
| 续期 | UPDATE expires_at | PUT `/tyk/keys/{key_id}` |

### 启动注册

Python services 进程启动时：

1. 读 PG：`SELECT definition FROM ichse.api_definitions WHERE status = 'active'`
2. 逐个 POST 到 Tyk `/tyk/apis/`（Tyk 幂等覆盖，api_id 不变）
3. 更新 `last_sync_at`

此逻辑仅针对系统自身管理的 API，与第三方服务无关。第三方服务的 API 定义在 PG 中维护，Tyk 只管转发。

---

## 五、废弃项

| 项目 | 原因 |
|------|------|
| `generate_tyk_apis.py` | 不再生成 JSON 文件，API 直接注册到 Tyk |
| `api-definitions/` 目录 | 无文件持久化需求，加入 `.gitignore` |
| `apps/` 目录挂载 | Tyk 不再从文件系统加载 API 定义 |
| Tyk 热重载 `/tyk/reload/` | POST 注册即时生效，无需重载 |

---

## 六、关键决策

> **PG 是 API 定义的唯一权威源。**
> Tyk 是运行时执行引擎，Redis 是瞬时缓存。
> 不写 JSON 文件，不挂载目录。所有操作先写 PG，再同步 Tyk。

> **api_id 由系统生成，格式 `ichse-{interface_id}`（小写）。**
> Tyk 的 POST /tyk/apis/ 以 api_id 为主键做幂等覆盖，不会改变 api_id。
> 密钥和日志通过 api_id 关联，保持稳定。

> **服务启动注册仅针对平台自身管理的 API。**
> 第三方服务的 API 定义在 PG 中维护，注册/停用由管理操作触发，不由服务启动触发。
