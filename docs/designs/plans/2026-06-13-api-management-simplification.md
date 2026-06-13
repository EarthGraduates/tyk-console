# API 管理简化实施计划

> 日期：2026-06-13 | 依赖：`docs/designs/api-management-model.md`

---

## Step 1: 数据库调整

- [ ] `ichse.api_definitions` 新增 `interface_id text REFERENCES biz.interfaces(interface_id)`（可选 FK）
- [ ] `ichse.api_definitions` 确认 `definition JSONB` 列可存完整 Tyk JSON
- [ ] 迁移脚本：`015_api_definitions_interface_id.sql`

---

## Step 2: 后端 API 改造

- [ ] `services/routes/admin.py` 新增 `/admin/register-api`：从 `biz.interfaces` 一键注册到 `api_definitions` + 调 Tyk
- [ ] `services/routes/admin.py` 新增 Tyk 同步逻辑：停用/启用/删除操作同步调 Tyk
- [ ] `services/routes/admin.py` 新增密钥 CRUD 同步 Tyk 逻辑
- [ ] `services/main.py` 新增启动注册：读 active API → POST Tyk
- [ ] `config.py` 新增 `TYK_URL`、`TYK_SECRET` 配置

---

## Step 3: 前端页面

- [ ] 合并 `/apis` + `/api-records` → **API 定义** 页面
  - 列表：PG `api_definitions` 数据 + Tyk 实时状态（运行中/未同步/已下线）
  - 新建/编辑表单
  - 启停按钮（停用/重新启用 → PG + Tyk）
  - 同步按钮（手动 POST Tyk）

- [ ] 新增 **接口管理** 页面 `/interfaces`
  - 列表：`biz.interfaces` 数据
  - 一键注册按钮 → 弹窗填写 listen_path/auth_mode → 调 `/admin/register-api`

- [ ] **密钥管理** 页面 `/keys` 改造
  - 数据源从直连 Tyk 改为 PG `api_keys` + Tyk 同步
  - 创建/吊销操作：PG 写 + 调 Tyk

- [ ] 菜单调整
  - 移除旧的 API 服务（原 `/apis`）入口
  - 新增 接口管理 入口

---

## Step 4: 清理

- [ ] 删除 `generate_tyk_apis.py`
- [ ] 删除 `api-definitions/` 目录
- [ ] 更新 `.gitignore`：排除 `api-definitions/`
- [ ] 更新 `docs/architecture.md` 反映新模型
- [ ] 更新 `docs/conventions.md` 章节引用

---

## Step 5: 测试

- [ ] 服务启动注册验证（PG → Tyk）
- [ ] API CRUD 全流程（新建 → 停用 → 重新启用 → 删除）
- [ ] 密钥 CRUD 全流程（创建 → 吊销）
- [ ] 一键注册流程（`biz.interfaces` → `api_definitions` → Tyk）
- [ ] 36 接口全量测试（确认网关路由不中断）
