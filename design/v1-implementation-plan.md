# ichse-asset-share-center — v1 实施与验证计划

> 设计文档：`design/tyk-gateway-management-ui.md`
> 框架版本：Refine v5 + Ant Design v5
> 预计工期：总计约 14-18 天

---

## 整体 Stage 路线图

```
Stage 0 ─→ Stage 1 ─→ Stage 2 ─→ Stage 3 ─→ Stage 4 ─→ Stage 5 ─→ Stage 6
环境搭建   后端代理    仪表板      API管理     密钥管理     日志查看     验证发布
 2天        3天        2天         3天         1.5天       3.5天       1天
```

---

## Stage 0：环境搭建（预计 2 天）

### 目标
搭建本地开发所需的全部 Docker 基础设施，确保 Tyk Gateway 可运行、可操作。

### 任务清单

| # | 任务 | 产出 | 验收条件 |
|---|------|------|---------|
| 0.1 | 编写 `docker-compose.yml`，包含 Tyk Gateway + Redis + MongoDB | `docker-compose.yml` | `docker compose up -d` 后三容器正常运行 |
| 0.2 | 配置 Tyk Gateway（tyk.conf），确保管理 API 可用 | `tyk.conf` 文件 | `curl localhost:8080/hello` 返回版本号 + status=pass |
| 0.3 | 配置 Tyk Pump，连接 MongoDB 作为日志后端 | `pump.conf` 文件 | Pump 日志显示 "connecting to MongoDB" 无报错 |
| 0.4 | 创建测试 API 并验证链路 | — | 通过 Tyk API 创建 keyless API → curl 调通 |
| 0.5 | 确认 Refine 前端可正常 dev 启动 | — | `npm run dev` 成功，浏览器可打开页面 |
| 0.6 | （v2 预留）PostgreSQL 镜像声明在 compose 中但注释掉 | `docker-compose.yml` 注解 | — |

### 验证

- [ ] `curl localhost:8080/hello` 返回 `{"status": "pass", "version": "v5.x.x"}`
- [ ] `curl -H "x-tyk-authorization: xxx" localhost:8080/tyk/apis/` 返回 `[]`
- [ ] `curl -X POST ... /tyk/apis/` 能成功创建 API
- [ ] Tyk Pump 日志显示 analytics 数据正常搬运
- [ ] `npm run dev` 可正常访问 Refine 页面

---

## Stage 1：后端代理服务（预计 3 天）

### 目标
构建 Node.js/Go 后端代理，作为前端与 Tyk/Docker/MongoDB 之间的中间层。

### 任务清单

| # | 任务 | 产出 | 验收条件 |
|---|------|------|---------|
| 1.1 | 项目初始化（Express/Fastify + TypeScript） | 后端项目脚手架 | `npm run dev` 启动，健康检查 `/api/health` 返回 ok |
| 1.2 | Tyk API Client 模块 | `src/clients/tyk-client.ts` | 封装 5 个 CRUD + reload + health 调用 |
| 1.3 | Docker API Client 模块 | `src/clients/docker-client.ts` | 封装容器状态查询 + start/stop/restart |
| 1.4 | MongoDB 查询模块 | `src/clients/mongo-client.ts` | analytics 集合的条件查询 + 分页 |
| 1.5 | Tyk API 路由：apis CRUD | `src/routes/tyk-apis.ts` | 转发正确、reload 联动正确 |
| 1.6 | Tyk API 路由：keys CRUD | `src/routes/tyk-keys.ts` | 转发正确 |
| 1.7 | Health / Reload 路由 | `src/routes/tyk-health.ts` | 正确转发 |
| 1.8 | Docker 管理路由 | `src/routes/gateway.ts` | start/stop/restart/status |
| 1.9 | 日志查询路由 | `src/routes/logs.ts` | 支持所有过滤条件 + 分页 |
| 1.10 | 配置管理路由 | `src/routes/config.ts` | 读写 Tyk 连接配置、测试连接 |
| 1.11 | 敏感信息脱敏中间件 | `src/middleware/sanitize.ts` | Authorization Header 值自动隐藏 |

### v1 后端代理 API 清单

```
GET    /api/health                    # 健康检查
GET    /api/config                    # 读取配置
PUT    /api/config                    # 更新配置
POST   /api/config/test               # 测试 Tyk 连通性

GET    /api/tyk/health                # Tyk 网关健康（转发 /hello）
POST   /api/tyk/reload                # Tyk 重载

GET    /api/tyk/apis                  # 列出 API
POST   /api/tyk/apis                  # 创建 API
GET    /api/tyk/apis/:apiID           # API 详情
PUT    /api/tyk/apis/:apiID           # 更新 API
DELETE /api/tyk/apis/:apiID           # 删除 API

GET    /api/tyk/keys                  # 列出密钥
POST   /api/tyk/keys/create           # 创建密钥
PUT    /api/tyk/keys/:keyId           # 更新密钥
DELETE /api/tyk/keys/:keyId           # 删除密钥

GET    /api/gateway/status            # Docker 容器状态
POST   /api/gateway/start             # 启动 Tyk
POST   /api/gateway/stop              # 停止 Tyk
POST   /api/gateway/restart           # 重启 Tyk

GET    /api/logs                      # 日志列表（分页+过滤）
GET    /api/logs/:id                  # 单条日志详情
```

### 验证

- [ ] 每个 API 端点都返回正确状态码和数据格式
- [ ] 创建 API 后自动调 reload，无需手动触发
- [ ] 测试连接接口能正确返回 Tyk 健康状态
- [ ] Docker 管理接口能正确启停 Tyk 容器
- [ ] 日志查询接口返回正确的 analytics 记录
- [ ] RawRequest/RawResponse 中 Authorization Header 值被脱敏

---

## Stage 2：仪表板（预计 2 天）

### 目标
实现网关状态总览 + API 健康指标面板。

### 任务清单

| # | 任务 | 产出 | 验收条件 |
|---|------|------|---------|
| 2.1 | 创建 Dashboard 页面 + 路由注册 | `src/pages/dashboard/index.tsx` | 路由 `/dashboard` 可访问 |
| 2.2 | 网关状态卡片（版本/Redis/运行状态） | `src/components/health-card.tsx` | 从代理 `/api/tyk/health` 获取数据显示 |
| 2.3 | 全局统计卡片（API 总数/请求率/平均延迟） | 仪表板组件 | 从 `/api/tyk/health` 遍历聚合数据 |
| 2.4 | API 健康指标列表（请求率/延迟/错误率） | 仪表板表格 | 每行一个 API，带状态指示 |
| 2.5 | 一键重载按钮 + 反馈 | 仪表板按钮 | 调 `/api/tyk/reload` → 显示结果 |
| 2.6 | 自动轮询刷新（间隔可配置） | useInterval hook | 10s 自动刷新，可暂停 |

### 验证

- [ ] 页面打开时正确显示 Tyk 版本号
- [ ] Redis 正常时显示 ✅，断开时显示 ❌
- [ ] 创建/删除 API 后统计数字正确更新
- [ ] 重载成功后显示 "重载完成" 提示
- [ ] 轮询间隔配置生效

---

## Stage 3：API 服务管理（预计 3 天）

### 目标
实现 API Definition 的完整 CRUD 界面（v1 核心字段）。

### 任务清单

| # | 任务 | 产出 | 验收条件 |
|---|------|------|---------|
| 3.1 | 创建 API 列表页（表格 + 搜索/筛选） | `src/pages/apis/list.tsx` | 数据正确加载，列完整 |
| 3.2 | 创建 API 表单（基础 Tab：名称/路由/认证） | `src/pages/apis/create.tsx` + 组件 | 正确提交到后端代理 |
| 3.3 | 创建 API 表单（进阶 Tab：限流/CORS/缓存） | 同上扩展 | 字段联动正确 |
| 3.4 | 编辑 API 页面（预填 + 修改 + 提交） | `src/pages/apis/edit.tsx` | 预填正确，提交后自动 reload |
| 3.5 | 查看 API 详情（JSON 格式化只读） | `src/pages/apis/show.tsx` | 完整 JSON 展示 |
| 3.6 | 删除 API（确认弹窗 + 自动 reload） | 列表页操作列 | 删除成功提示 + 列表刷新 |
| 3.7 | 连接前端到后端代理（自定义 Data Provider） | `src/providers/tyk-data-provider.ts` | 全部 CRUD 走代理 |

### 创建表单 — v1 覆盖字段

| Tab | 字段 |
|-----|------|
| 基本信息 | name, api_id, active, tags |
| 路由配置 | proxy.listen_path, proxy.target_url, proxy.strip_listen_path, domain |
| 认证配置 | use_keyless, auth.auth_header_name, use_basic_auth, enable_jwt (简化) |
| 速率限制 | rate, per, disable_rate_limit |
| CORS | 全部 9 个字段（enable, origins, methods, headers, exposed, credentials, max_age, options_passthrough） |
| 缓存 | enable_cache, cache_timeout |

### 验证

- [ ] 创建一个 keyless API → curl 调网关可通
- [ ] 创建一个 Token 认证 API → 无密钥返回 401，有密钥返回 200
- [ ] 编辑上游 URL → 请求路由到新地址
- [ ] 删除 API → 该 API 不可再访问
- [ ] 搜索按名称/认证方式筛选正确
- [ ] 创建后自动 reload 不需要手动操作

---

## Stage 4：密钥管理（预计 1.5 天）

### 目标
实现 API Token 的全生命周期管理界面。

### 任务清单

| # | 任务 | 产出 | 验收条件 |
|---|------|------|---------|
| 4.1 | 密钥列表页（表格 + 状态指示） | `src/pages/keys/list.tsx` | 数据正确，状态标签正确 |
| 4.2 | 创建密钥表单（授权 API 选择 + 配额/速率/过期） | `src/pages/keys/create.tsx` | 正确提交 |
| 4.3 | 编辑密钥表单 | `src/pages/keys/edit.tsx` | 预填正确 + 保存成功 |
| 4.4 | 吊销密钥（确认弹窗） | 列表页操作列 | 密钥不可再使用 |

### 验证

- [ ] 创建一个密钥分配给 API → 用该密钥 curl 可调通
- [ ] 修改密钥配额 → 达配额上限后请求被限
- [ ] 修改密钥速率 → 超过速率后返回 429
- [ ] 吊销密钥 → curl 返回 403
- [ ] 密钥过期后自动显示 🔴 状态

---

## Stage 5：日志查看（预计 3.5 天）

### 目标
实现基于 MongoDB analytics 数据的日志查询与详情浏览。

### 任务清单

| # | 任务 | 产出 | 验收条件 |
|---|------|------|---------|
| 5.1 | 日志列表页基础框架 | `src/pages/logs/index.tsx` | 分页列表，从代理 `/api/logs` 加载 |
| 5.2 | 过滤条件组件（API/时间/状态码/方法/密钥/路径/IP） | `src/components/log-filters.tsx` | 组合过滤生效 |
| 5.3 | 日志详情面板（RawRequest/RawResponse 解码） | `src/components/log-detail-panel.tsx` | 点击展开+关闭 |
| 5.4 | HTTP 格式化 + 语法高亮组件 | `src/components/code-viewer.tsx` | 请求/响应原文格式化 |
| 5.5 | 敏感信息脱敏展示 | 后端代理已实现 | Authorization 值显示 `***` |
| 5.6 | 时间范围必填验证 + UI 提示 | 过滤组件 | 未选时间范围时查询按钮不可用/有提示 |
| 5.7 | 后端日志查询 API 分页 + 聚合 | 后端路由 | 支持 skip/limit，返回 total 数 |

### 验证

- [ ] 不选时间范围，查询按钮置灰/提示「请选择时间范围」
- [ ] 按 API 筛选后只显示该 API 的日志
- [ ] 按状态码 4xx/5xx 筛选正确
- [ ] 点击单条日志展开完整 RawRequest 原文
- [ ] 按密钥 ID 搜索日志
- [ ] RawRequest 超长时自动截断（>= 50KB 提示）
- [ ] Authorization Header 值显示为 `***`
- [ ] 翻页正常工作，总数正确

---

## Stage 6：网关管理 + 设置（预计 1 天）

### 目标
实现 Tyk 容器启停管理、连接配置页面。

### 任务清单

| # | 任务 | 产出 | 验收条件 |
|---|------|------|---------|
| 6.1 | 网关管理页面（容器状态 + 启停操作） | `src/pages/gateway/index.tsx` | 显示正确状态 |
| 6.2 | 设置页面（连接配置 + 测试连接） | `src/pages/settings/index.tsx` | 配置可保存、测试可用 |
| 6.3 | 网关断开全局 banner 提示 | `src/App.tsx` | 后端代理不可达时顶栏黄色警告 |

### 验证

- [ ] 网关状态页面正确显示 Tyk 容器运行/停止状态
- [ ] 点击停止 → 仪表板标记网关离线
- [ ] 点击启动 → 恢复正常
- [ ] 修改配置后测试连接验证
- [ ] 后端代理不可达时全局 banner 显示

---

## Stage 7：集成验证与发布（预计 1 天）

### 目标
完整走通所有 v1 功能，逐项验收，确认可交付。

### 验收清单（Owner 审核用）

#### 网关仪表板
- [ ] 能正确显示 Tyk 版本号
- [ ] Redis 状态正常/异常时展示正确
- [ ] 每个已创建的 API 健康卡片展示正确
- [ ] 一键重载成功且有反馈
- [ ] 统计数据随 API 增删正确更新

#### API 管理
- [ ] 创建一个 keyless API，验证 curl 能调通
- [ ] 创建一个带 Token 认证的 API，验证未授权返回 401
- [ ] 编辑 API 的上游 URL，验证请求路由到新地址
- [ ] 编辑 API 认证方式从 keyless 改为 Token，验证原请求返回 401
- [ ] 启用/停用 API 正确工作
- [ ] 删除 API，验证该 API 不再可用
- [ ] 列表中搜索/筛选正常工作
- [ ] 创建后自动 reload，无需手动操作

#### 密钥管理
- [ ] 创建密钥，分配给特定 API，验证能成功调用
- [ ] 修改密钥配额，验证达限制后返回 429
- [ ] 修改密钥速率，验证超出后返回 429
- [ ] 吊销密钥，验证该密钥无法再调用
- [ ] 密钥列表状态标签正确（有效/即将过期/已过期/吊销）

#### 日志查看
- [ ] 时间范围必填，不选时无法查询
- [ ] 按 API 筛选后只显示该 API 的日志
- [ ] 按状态码/方法/密钥 ID 过滤正确
- [ ] 展开 RawRequest 能看到完整的 HTTP 请求原文
- [ ] 展开 RawResponse 能看到完整的 HTTP 响应原文
- [ ] 内容超长时自动截断
- [ ] Authorization 等敏感 Header 值已脱敏

#### 网关管理
- [ ] 能正确显示 Tyk Docker 容器运行状态
- [ ] 停止容器 → 仪表板标记网关离线
- [ ] 启动容器 → 恢复正常
- [ ] 修改连接配置后能连通

#### 设置
- [ ] 配置可保存（持久化）
- [ ] 测试连接能反馈成功/失败
- [ ] Tyk 断开连接时全局 banner 提示

#### 全局
- [ ] Supabase Auth 登录正常
- [ ] 未登录不能访问任何页面
- [ ] 侧边栏导航所有页面可正常跳转
- [ ] 整体 UI 风格一致，无布局断裂
- [ ] 浏览器控制台无错误

---

## 附录：版本边界速查

| 模块 | v1 状态 | v2 规划 |
|------|:-------:|---------|
| 网关仪表板 | ✅ 完整覆盖 | 更多统计图表 |
| 网关管理（Docker） | ✅ 基础启停 | 多实例管理/生产部署 |
| API 管理 | ✅ 核心字段 CRUD | 全字段（120+）+ 版本管理 + OAS |
| 密钥管理 | ✅ 完整覆盖 | 批量操作/策略绑定 |
| 日志查看 | ✅ 基础查询+详情 | 趋势图/告警/导出 |
| OAuth 管理 | ❌ 跳过 | v2 考虑 |
| 自定义中间件 | ❌ 跳过 | v2 考虑 |
| 服务业务属性 | ❌ 跳过 | ✅ **v2 核心定位** |
| PostgreSQL 集成 | ❌ 跳过 | ✅ v2 核心基础设施 |
| 配置快照/审计日志 | ❌ 跳过 | ✅ v2 |
