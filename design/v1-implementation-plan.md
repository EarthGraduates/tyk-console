# ichse-asset-share-center — v1 实施与验证计划

> 设计文档：`design/tyk-gateway-management-ui.md`
> v1 架构：Refine v5 + Ant Design v5 + Supabase Auth，Data Provider 直调 Tyk Gateway API
> Docker 管理：dockerode (Node.js Docker SDK) 极简管理服务（~60 行）
> v2 架构：v1 + PostgreSQL（业务数据）+ 后端业务服务
> 预计工期：总计约 9-11 天

---

## 整体 Stage 路线图

```
Stage 0 ─→ Stage 1 ─→ Stage 2 ─→ Stage 3 ─→ Stage 4 ─→ Stage 5
环境确认  Docker管理   仪表板      API管理     密钥管理     集成验证
 0.5天     +DataProv   2天         3天         1.5天       1天
            1天
```

> v1 不包含：日志查看（Pump → MongoDB）、PostgreSQL 集成、OAuth 管理、API 版本管理。这些划入 v2。

---

## Stage 0：环境确认（预计 0.5 天）

### 目标
确认 Tyk Gateway 已正确部署且管理 API 可用，Refine 前端可正常开发。

### 任务清单

| # | 任务 | 验收条件 |
|---|------|---------|
| 0.1 | 确认 Tyk Gateway 运行中 | `curl localhost:8080/hello` 返回版本号 + `status: "pass"` |
| 0.2 | 确认管理 API 可用 | `curl -H "x-tyk-authorization: <secret>" localhost:8080/tyk/apis/` 返回 `[]` |
| 0.3 | 创建测试 API 验证链路 | 通过 curl 创建 keyless API → 调通 → 删除 |
| 0.4 | 确认 Refine 前端可 dev 启动 | `npm run dev` 成功，浏览器访问正常 |
| 0.5 | 确认 Supabase Auth 配置 | 登录/注册页面可访问 |

### 验证

- [ ] `curl localhost:8080/hello` 正常返回
- [ ] Tyk 管理 API CRUD 均可用
- [ ] `npm run dev` 正常

---

## Stage 1：Docker 管理服务 + Data Provider（预计 1 天）

### 目标
搭建 Docker 管理服务（dockerode）+ 实现 Tyk Data Provider（Refine 数据层）。

### 任务清单

| # | 任务 | 产出 | 验收条件 |
|---|------|------|---------|
| 1.1 | 搭建 Docker 管理服务 | `docker-manager/index.js` | `npm install dockerode express` 后可启动 |
| 1.2 | 实现容器状态查询 | `GET /api/gateway/status` | 返回 JSON `{ running, status, version, ports }` |
| 1.3 | 实现启动/停止/重启 | `POST /api/gateway/{start,stop,restart}` | 操作成功返回状态变更 |
| 1.4 | 启动服务并验证 | `node index.js` | curl 各端点正常，Docker 容器可启停 |
| 1.5 | 编写 Tyk Data Provider（apis CRUD + 自动 reload） | `src/providers/tyk-data-provider.ts` | 5 个 Refine Action 正确映射到 Tyk 端点 |
| 1.6 | 编写 Tyk Data Provider（keys CRUD） | 同上文件扩展 | 密钥 CRUD 正确映射 |

### Docker 管理服务 API 清单

| 方法 | 路径 | 说明 | 返回示例 |
|------|------|------|---------|
| `GET` | `/api/gateway/status` | 容器运行状态 | `{ running: true, status: "Up 3 days", startedAt: "...", version: "v5.7.0" }` |
| `POST` | `/api/gateway/start` | 启动容器 | `{ ok: true, action: "start" }` |
| `POST` | `/api/gateway/stop` | 停止容器 | `{ ok: true, action: "stop" }` |
| `POST` | `/api/gateway/restart` | 重启容器 | `{ ok: true, action: "restart" }` |

### 验证

- [ ] Docker 管理服务 `npm start` 可启动
- [ ] `curl localhost:3001/api/gateway/status` 返回正确状态
- [ ] `curl -X POST localhost:3001/api/gateway/restart` 成功重启 Tyk
- [ ] Data Provider `getList` / `getOne` / `create` / `update` / `deleteOne` 均可正确调用
- [ ] create/update/deleteOne 成功后自动 reload

---

## Stage 2：仪表板 + 网关管理（预计 2 天）

### 目标
实现网关状态仪表板 + Docker 启停管理页面。

### 任务清单

| # | 任务 | 产出 | 验收条件 |
|---|------|------|---------|
| 2.1 | 创建 Dashboard 页面 + 路由 | `src/pages/dashboard/index.tsx` | 路由 `/` 可访问 |
| 2.2 | 网关状态卡片（版本/Redis/运行状态） | `src/components/health-card.tsx` | 从 `/hello` 获取数据显示 |
| 2.3 | 全局统计卡片（API 总数/请求率/平均延迟） | 仪表板组件 | 从 `/tyk/health/` 遍历聚合 |
| 2.4 | API 健康指标列表（请求率/延迟/错误率） | 仪表板表格 | 每行一个 API，状态指示 |
| 2.5 | 一键重载按钮 + 确认弹窗 + 结果反馈 | 仪表板按钮 | 调 `/tyk/reload/` → 显示结果 |
| 2.6 | 自动轮询刷新（间隔 10s 可配置） | useInterval hook | 仪表板自动更新 |
| 2.7 | 网关管理页面（Docker 容器状态 + 启停按钮） | `src/pages/gateway/index.tsx` | 调 Docker 管理服务，状态正确 |
| 2.8 | 设置页面（Gateway 地址 + Secret + Docker 服务地址，存 localStorage） | `src/pages/settings/index.tsx` | 配置可保存、测试连接可用 |

### 验证

- [ ] 页面打开时正确显示 Tyk 版本号
- [ ] Redis 正常时显示 ✅，断开时显示 ❌
- [ ] 创建/删除 API 后统计数字正确更新
- [ ] 一键重载成功有反馈
- [ ] 网关管理页面正确显示容器运行/停止状态
- [ ] 点击停止 → 容器停止 → 仪表板标记网关离线
- [ ] 点击启动 → 容器启动 → 恢复正常
- [ ] 轮询间隔配置生效
- [ ] 设置页可保存全部配置项
- [ ] 测试连接功能可用

---

## Stage 3：API 服务管理（预计 3 天）

### 目标
实现 API Definition 的完整 CRUD 界面（v1 核心字段）。

### 任务清单

| # | 任务 | 产出 | 验收条件 |
|---|------|------|---------|
| 3.1 | API 列表页（表格 + 搜索/筛选） | `src/pages/apis/list.tsx` | 字段完整、搜索正常工作 |
| 3.2 | 创建 API 表单 — 基本信息 + 路由配置 | `src/pages/apis/create.tsx` | 正确提交到 Tyk API |
| 3.3 | 创建 API 表单 — 认证配置 + 速率限制 | 同上扩展 Tab | 各认证模式正确 |
| 3.4 | 创建 API 表单 — CORS + 缓存配置 | 同上扩展 Tab | 字段联动正确 |
| 3.5 | 编辑 API 页面（预填 + 修改 + 提交） | `src/pages/apis/edit.tsx` | 预填正确，提交后自动 reload |
| 3.6 | 查看 API 详情（JSON 格式化只读） | `src/pages/apis/show.tsx` | 完整 JSON 展示 |
| 3.7 | 删除 API（确认弹窗 + 自动 reload） | 列表页操作列 | 删除后不可访问 |

### 创建表单 — v1 覆盖字段

| Tab | 字段 |
|-----|------|
| 基本信息 | name, api_id, active, tags |
| 路由配置 | proxy.listen_path, proxy.target_url, proxy.strip_listen_path, domain |
| 认证配置 | use_keyless, auth.auth_header_name, use_basic_auth, enable_jwt |
| 速率限制 | rate, per, disable_rate_limit |
| CORS | 全部 9 个字段 |
| 缓存 | enable_cache, cache_timeout |

> 高级设置（端点配置/版本管理/详细日志/自定义中间件）划入 v2。

### 验证

- [ ] 创建一个 keyless API → curl 调网关可通
- [ ] 创建一个 Token 认证 API → 无密钥返回 401，有密钥返回 200
- [ ] 编辑上游 URL → 请求路由到新地址
- [ ] 编辑 API 认证方式 → 生效
- [ ] 启用/停用 API 正确工作
- [ ] 删除 API → 该 API 不可再访问
- [ ] 搜索按名称/认证方式筛选正确
- [ ] 创建/编辑/删除后自动 reload，无需手动操作
- [ ] 设置页配置的 Secret 不影响已有 API

---

## Stage 4：密钥管理（预计 1.5 天）

### 目标
实现 API Token 的全生命周期管理界面。

### 任务清单

| # | 任务 | 产出 | 验收条件 |
|---|------|------|---------|
| 4.1 | 密钥列表页（表格 + 状态指示） | `src/pages/keys/list.tsx` | 数据正确，状态标签正确 |
| 4.2 | 创建密钥表单（授权 API 选择 + 配额/速率/过期） | `src/pages/keys/create.tsx` | 创建成功，可用密钥调 API |
| 4.3 | 编辑密钥表单 | `src/pages/keys/edit.tsx` | 预填正确 + 保存成功 |
| 4.4 | 吊销密钥（确认弹窗） | 列表页操作列 | 密钥不可再使用 |

### 验证

- [ ] 创建一个密钥分配给 API → 用该密钥 curl 可调通
- [ ] 修改密钥配额 → 达配额上限后请求被限
- [ ] 修改密钥速率 → 超过速率后返回 429
- [ ] 吊销密钥 → curl 返回 403
- [ ] 密钥过期后自动显示 🔴 状态

---

## Stage 5：集成验证与发布（预计 1 天）

### 目标
完整走通所有 v1 功能，逐项验收，确认可交付。

### 验收清单（Owner 审核用）

#### 网关仪表板
- [ ] 网关版本 + Redis 状态展示正确
- [ ] 统计卡片（API 总数/请求率/平均延迟）正确
- [ ] 每个 API 健康指标列表展示正确
- [ ] 一键重载成功且有反馈
- [ ] 统计数据随 API 增删正确更新
- [ ] 自动轮询刷新正常工作

#### 网关管理（Docker）
- [ ] 容器运行状态正确显示（运行中/已停止/重启中）
- [ ] 停止容器 → 仪表板标记网关离线
- [ ] 启动容器 → 恢复正常，可继续操作 Tyk API
- [ ] 重启容器 → 状态先显示"重启中"，之后恢复运行中
- [ ] 启停操作确认弹窗正常
- [ ] Docker 管理服务不可达时有降级提示

#### API 管理
- [ ] 创建一个 keyless API，curl 能调通
- [ ] 创建一个 Token 认证 API，未授权返回 401
- [ ] 编辑上游 URL，请求路由到新地址
- [ ] 编辑认证方式（keyless → Token），原请求返回 401
- [ ] 启用/停用 API 正确工作
- [ ] 删除 API，该 API 不再可用
- [ ] 搜索/筛选按名称、认证方式正确
- [ ] 创建/编辑/删除后自动 reload

#### 密钥管理
- [ ] 创建密钥 → 成功调用
- [ ] 修改配额 → 达限后返回 429
- [ ] 修改速率 → 超出后返回 429
- [ ] 吊销密钥 → 调用返回 403
- [ ] 状态标签正确（有效/即将过期/已过期）

#### 设置
- [ ] Gateway 地址 + Secret + Docker 服务地址可保存（localStorage）
- [ ] 测试连接反馈成功/失败
- [ ] 修改配置后页面立即生效

#### 全局
- [ ] Supabase Auth 登录正常
- [ ] 未登录不能访问
- [ ] 侧边栏导航所有页面可跳转
- [ ] UI 无布局断裂，控制台无错误

---

## 附录：版本边界速查

| 模块 | v1 状态 | v2 规划 |
|------|:-------:|---------|
| 网关仪表板 | ✅ 完整覆盖 | 更多统计图表 |
| 网关管理（Docker） | ✅ 启停/重启/状态 | 多实例管理/生产部署 |
| API 管理 | ✅ 核心字段 CRUD（6 Tab） | 全字段（120+）+ 版本管理 + OAS |
| 密钥管理 | ✅ 完整覆盖 | 批量操作/策略绑定 |
| 设置 | ✅ 基础配置 | 多实例 |
| 日志查看 | ❌ 跳过 | ✅ Pump→MongoDB→查询服务 |
| OAuth 管理 | ❌ 跳过 | v2 考虑 |
| 自定义中间件 | ❌ 跳过 | v2 考虑 |
| 服务业务属性 | ❌ 跳过 | ✅ **v2 核心定位** |
| PostgreSQL 集成 | ❌ 跳过 | ✅ v2 核心基础设施 |
