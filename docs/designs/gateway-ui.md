# Tyk 网关服务配置与监控界面 — 设计方案

> 项目：ichse-asset-share-center
> v1 架构：Refine v5 + Ant Design + Supabase (Auth)，Data Provider 直调 Tyk Gateway API
> v2 架构：v1 + PostgreSQL（业务数据）+ 后端业务服务
> Docker 管理：dockerode (Node.js Docker SDK，极简管理服务)
> 目标：构建一套完整的 Tyk API Gateway (OSS) 服务配置与监控管理界面

---

## 一、背景与目标

Tyk Gateway 是一个云原生的开源 API 网关（Go 语言），支持 REST/GraphQL/TCP/gRPC 协议。它本身暴露一套 RESTful 管理 API（端口 8080），但缺乏一套现代化、可视化的 Web 管理界面（官方 Dashboard 为商业化产品）。

本项目目标分为两个版本阶段：

### v1（纯工具层）
构建基于 Refine 框架的 **Tyk Gateway OSS 管理界面**，覆盖：
1. **网关管理** — 查看/启动/停止/重启 Tyk Gateway（Docker）容器（通过 dockerode）
2. **服务配置** — API 定义的全生命周期管理（CRUD）
3. **密钥管理** — API Token 的创建、编辑、吊销
4. **监控面板** — 网关健康状态 + 各 API 运行指标

> 设计原则：一切可配置。API 支持什么字段，页面就展示什么字段。不预设简化、不隐藏能力。

### v2（业务层 — 待规划）
在 v1 基础上加入业务属性：
- 服务基本信息（出入参、所属机构、服务编码）
- 服务调用关系管理
- 服务资产目录与共享

> v2 让 ichse-asset-share-center 不再是一个"工具"，而是一个"系统"。

---

## 二、系统架构

### 2.1 总体架构

```json
┌─────────────────────────────────────────────────────────────┐
│                    Refine UI (浏览器)                         │
│                                                             │
│  ⚡仪表板  🔌网关管理  🔌API管理  🔑密钥管理  ⚙设置          │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Custom Data Provider                        ││
│  │  getList / getOne / create / update / deleteOne          ││
│  │  ↓ 直调 Tyk Gateway API（x-tyk-authorization 验证）       ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │           Docker API Client (fetch)                      ││
│  │  ↓ 调 Docker 管理服务 (Node.js + dockerode)               ││
│  └─────────────────────────────────────────────────────────┘│
└──────────┬──────────────────────┬───────────────────────────┘
           │ HTTP (直连)          │ HTTP
    ┌──────▼──────┐       ┌──────▼──────────────┐
    │ Tyk Gateway │       │ Docker 管理服务      │
    │ ( :8080 )   │       │ (Express + dockerode)│
    │ ←→ Redis    │       │  :3001               │
    └─────────────┘       └──────┬───────────────┘
                                 │ unix socket
                          ┌──────▼──────┐
                          │ Docker Daemon│
                          │ (container)  │
                          └─────────────┘
```

**两个数据源**：
| 数据源 | 协议 | 用途 |
|--------|------|------|
| Tyk Gateway API | HTTP (直连) | API CRUD / 密钥 / 健康检查 / 重载 |
| Docker 管理服务 | HTTP (localhost:3001) | 容器状态查询 / 启动 / 停止 / 重启 |

**核心设计思路**：Refine 框架通过 **Data Provider** 模式抽象 Tyk API 调用，直接发 `x-tyk-authorization` 头的 HTTP 请求。Docker 容器管理通过一个极简的 Node.js 服务（`dockerode` 调用 Docker Daemon）实现，约 60 行代码，不属于"后端代理"——它不转发 Tyk API 调用。Tyk API 自身的 `x-tyk-authorization` 验证足够 v1 使用，无需额外认证中间层。

### 2.2 Docker 管理服务（dockerode）

Docker 容器管理无法从浏览器直接调用（需要访问 Docker Daemon 的 unix socket）。通过一个极简的 Node.js 服务桥接：

```js
const Docker = require('dockerode');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// 获取 Tyk Gateway 容器
const container = docker.getContainer('tyk-gateway');

// 状态查询 → GET  /api/gateway/status
container.inspect()  →  { State: { Running, Status, StartedAt }, ... }

// 启动 → POST /api/gateway/start
container.start()

// 停止 → POST /api/gateway/stop
container.stop()

// 重启 → POST /api/gateway/restart
container.restart()
```

**服务 API 清单**（4 个端点）：

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/gateway/status` | 容器运行状态 + Tyk 版本 + 端口映射 |
| `POST` | `/api/gateway/start` | 启动 Tyk Gateway 容器 |
| `POST` | `/api/gateway/stop` | 停止 Tyk Gateway 容器（确认后执行） |
| `POST` | `/api/gateway/restart` | 重启 Tyk Gateway 容器 |

**部署**：该服务与 Tyk Gateway 在同一台机器上运行，通过 Docker unix socket 通信。约 60 行代码，`npm install dockerode express` 即可启动。

> **部署约束**：dockerode 服务依赖 Docker unix socket (`/var/run/docker.sock`)，必须与 Docker Daemon 在同一台主机上运行，不支持远程 Docker。若未来将 Tyk 迁移至 Kubernetes（Tyk Operator 管理），需重新设计 Docker 管理方案。

### 2.3 Refine Data Provider → Tyk API 映射关系

```
┌────────────────────────────────────────────────────────┐
│                    Refine UI                            │
│   ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│   │ APIs    │  │ Keys     │  │ Dashboard│  │ Settings│ │
│   └────┬────┘  └────┬─────┘  └────┬─────┘  └───┬────┘ │
│        │            │              │             │      │
│   ┌────▼────────────▼──────────────▼─────────────▼──┐   │
│   │          Tyk Data Provider                      │   │
│   │  (自定义 Refine dataProvider)                   │   │
│   │  HTTP 直连 Tyk Gateway，x-tyk-authorization 认证  │   │
│   └─────────────────────┬──────────────────────────┘   │
│                         │ HTTP                          │
└─────────────────────────┼──────────────────────────────┘
                          │
                  ┌───────▼────────┐
                  │  Tyk Gateway   │  ←→ Redis
                  │  (localhost:8080)│
                  └────────────────┘
```

**映射表：**

| Refine Action | Tyk Gateway Endpoint | 说明 |
|---------------|---------------------|------|
| `getList` | `GET /tyk/apis/` | 列出所有 API 定义 |
| `getOne` | `GET /tyk/apis/{apiID}` | 获取单个 API 定义 |
| `create` | `POST /tyk/apis/` | 创建 API 定义 |
| `update` | `PUT /tyk/apis/{apiID}` | 更新 API 定义 |
| `deleteOne` | `DELETE /tyk/apis/{apiID}` | 删除 API 定义 |
| `getList` | `GET /tyk/keys/` | 列出密钥 |
| `create` | `POST /tyk/keys/create` | 创建密钥 |
| `update` | `PUT /tyk/keys/{keyId}` | 更新密钥 |
| `deleteOne` | `DELETE /tyk/keys/{keyId}` | 删除密钥 |

> **Reload 策略**：Tyk Gateway 的 `/tyk/reload/` 会导致所有 API 短暂不可用（约 1-3 秒），高频 reload 会放大中断影响。因此：
> - 默认开启「自动 reload」模式：每次 create/update/deleteOne 后自动调用 `/tyk/reload/`（适合开发/测试环境，操作频率低）
> - 提供「暂停自动 reload」开关：关闭后，Data Provider 仅标记操作状态为「未生效」，顶部显示 banner「有 N 项未生效的更改，点击应用」
> - 点击 banner 一次性调用 `/tyk/reload/`，所有更改批量生效
> - 仪表板显示「距离上次 reload」时间和 reload 次数计数器

### 2.4 数据库定位

| 数据库 | 用途 | 部署方式 | v1 需要？ |
|--------|------|---------|:--------:|
| **Redis** | Tyk Gateway 运行时存储 | Tyk Docker 依赖 | ✅ 已部署 |
| **MongoDB** | Pump 日志存储 | 独立 Docker | ❌ v2 |
| **PostgreSQL** | v2 业务数据 | 独立 Docker | ❌ v2 |
| **Supabase** | 用户认证 | 在线服务 | ✅ 已集成 |

> v1 不需要额外部署任何数据库。Tyk Gateway + Redis 已就绪即可。

### 2.5 网关连接配置与安全

配置存入前端 `localStorage`，设置页提供配置入口：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| Tyk Gateway 地址 | `http://localhost:8080` | Tyk Gateway 监听地址 |
| API Secret | — | `x-tyk-authorization` Header 值 |
| Docker 管理服务地址 | `http://localhost:3001` | Docker 管理服务监听地址 |
| 轮询间隔 | `10s` | 监控数据自动刷新间隔 |

**安全说明**：
- API Secret 存储在浏览器 `localStorage`，存在 XSS 泄露风险。v1 定位为内网/开发环境管理工具，该风险可接受。生产环境需通过后端代理托管 Secret
- 设置页面 Secret 输入框使用 `type="password"`，并提供「显示/隐藏」切换

**Auth 与 Secret 关系**：
- Supabase Auth 用于登录控制和页面访问保护
- v1 所有登录用户共用同一套 Tyk API Secret（存储在设置页的配置中）
- v2 如需要多租户隔离（不同用户有不同 Tyk 访问权限），需在后端服务中增加 Secret 托管层

---

## 三、v1 功能边界

### 3.1 v1 覆盖范围

#### 🟢 模块 A：网关仪表板（Gateway Dashboard）
| # | 功能 | 数据来源 | 说明 |
|---|------|---------|------|
| A1 | 网关运行状态展示（版本号、状态、Redis 连通性） | `GET /hello`（前端直调） | status: pass/fail + version |
| A2 | API 健康指标列表（请求率/延迟/错误数） | `GET /tyk/health/` 遍历 | 每个 API 一张状态卡 |
| A3 | 一键重载网关 | 前端直调 `/tyk/reload/` | 确认弹窗 + 结果反馈 |

#### 🟢 模块 B：API 服务管理（API Definitions）
| # | 功能 | 数据来源 | 说明 |
|---|------|---------|------|
| B1 | API 列表（名称/监听路径/上游URL/认证方式/状态） | `GET /tyk/apis/` | 表格展示 + 状态指示 |
| B2 | 创建 API（核心字段） | `POST /tyk/apis/` | 简化表单，覆盖高频字段 |
| B3 | 编辑 API（核心字段 + 限流 + CORS） | `PUT /tyk/apis/{id}` | 自动 reload |
| B4 | 查看 API 详情（只读完整 JSON） | `GET /tyk/apis/{id}` | JSON 格式化展示 |
| B5 | 删除 API（确认 + 自动 reload） | `DELETE /tyk/apis/{id}` | 级联 reload |
| B6 | 搜索/筛选 API（名称、认证方式、状态） | 前端过滤 | 快速定位 |

#### 🟢 模块 C：密钥管理（API Keys）
| # | 功能 | 数据来源 | 说明 |
|---|------|---------|------|
| C1 | 密钥列表（Key ID/关联 API/配额/过期/状态） | `GET /tyk/keys/` | 表格 + 状态标签 |
| C2 | 创建密钥（授权 API + 速率/配额/过期） | `POST /tyk/keys/create` | 完整 SessionObject 表单 |
| C3 | 编辑密钥（修改速率/配额/过期/禁用） | `PUT /tyk/keys/{keyId}` | |
| C4 | 吊销密钥 | `DELETE /tyk/keys/{keyId}` | 确认弹窗 |
| C5 | 搜索密钥 | 前端过滤 | |

#### 🟢 模块 E：网关管理（Gateway Lifecycle）
| # | 功能 | 数据来源 | 说明 |
|---|------|---------|------|
| E1 | 查看 Tyk Gateway 容器运行状态 | Docker 管理服务→dockerode | 运行中/已停止/重启中 + Tyk版本 |
| E2 | 启动 Tyk Gateway | 同上 | 确认后执行，显示结果 |
| E3 | 停止 Tyk Gateway | 同上 | 确认弹窗，显示结果 |
| E4 | 重启 Tyk Gateway | 同上 | 确认后执行，显示结果 |

### 3.2 v1 不覆盖（明确划给 v2）

| 功能 | 理由 |
|------|------|
| OAuth 客户端管理 | 配置复杂，使用场景少 |
| API 版本管理（version_data） | 高级功能，v1 先单版本跑通 |
| 自定义中间件/插件 | 需要写代码，不是 UI 配置操作 |
| 导入/导出 Swagger/OAS | 可选，v2 考虑 |
| 网关自身 tyk.conf 编辑 | 风险高，需谨慎设计 |
| 服务业务属性（机构/出入参/服务编码） | 这是 v2 的定位 |
| **日志查看（Pump → MongoDB）** | v1 不做，v2 再做日志查询服务 |
| 统计聚合图表（趋势/占比） | v2 随日志查询一起做 |

---

## 四、页面规划

### 4.1 全局导航

```
┌──────────────────────────────────────────────────────────┐
│  ☰ ichse Tyk Manager               🔆 🌛  admin@xyz     │
├──────────┬───────────────────────────────────────────────┤
│          │                                               │
│  ⚡ 仪表板│   (主内容区)                                   │
│  🔌 网关  │                                               │
│  🔌 服务  │                                               │
│  🔑 密钥  │                                               │
│  ⚙ 设置   │                                               │
│          │                                               │
└──────────┴───────────────────────────────────────────────┘
```

### 4.2 页面详述

#### 4.2.1 ⚡ 仪表板（Dashboard Overview）

**数据来源：** 直调 Tyk Gateway `GET /hello` + `GET /tyk/health/` (遍历)

**展示内容：**
```
┌──────────────────────────────────────────────────────────┐
│  Tyk Gateway: v5.x.x   ● 运行中    Redis: ● 正常        │
├──────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│ │ API 总数  │ │ 活跃 API  │ │ 请求/秒   │ │ 平均延迟     │ │
│ │    12    │ │    8     │ │  245.3   │ │   42ms       │ │
│ └──────────┘ └──────────┘ └──────────┘ └──────────────┘ │
├──────────────────────────────────────────────────────────┤
│  API 运行状态列表                                         │
│ ┌──────┬────────┬────────┬───────┬──────┬───────┬─────┐ │
│ │ 名称 │ 监听路径│ 上游URL │ 请求率 │ 延迟 │ 错误率│ 状态 │ │
│ │ ...  │  ...   │  ...   │  ...  │ ...  │  ...  │ 🟢  │ │
│ └──────┴────────┴────────┴───────┴──────┴───────┴─────┘ │
│                                        ⟳ 自动刷新 (10s)  │
│                                            [🔄 一键重载]  │
└──────────────────────────────────────────────────────────┘
```

**功能点：**
- 网关版本、运行状态、Redis 连通性（从 `/hello` 获取）
- 全局统计卡片（API 数量、活跃数、总请求速率、平均延迟）
- 每个 API 的健康指标列表（来自 `/tyk/health/`）
- 支持按状态筛选（正常/警告/异常）
- 手动刷新按钮（默认关闭自动轮询，避免 N+1 问题）
- 自动轮询开关（用户按需开启，可配置间隔）
- 一键重载按钮（`GET /tyk/reload/`），显示距离上次 reload 时间和 reload 次数

#### 4.2.2 🔌 网关管理（Gateway Lifecycle）

**数据来源：** Docker 管理服务（Node.js + dockerode，`localhost:3001`）

**展示内容：**
```
┌──────────────────────────────────────────────────────────┐
│  🔌 Tyk Gateway 管理                                     │
│                                                           │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  容器状态: ● 运行中 (up 3d 12h)                      │ │
│  │  容器名: tyk-gateway                                 │ │
│  │  Tyk 版本: v5.7.0                                    │ │
│  │  监听端口: 8080 → 8080                               │ │
│  │                                                       │ │
│  │  [▶ 启动] [⏹ 停止] [🔄 重启]                          │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  关联容器:                                            │ │
│  │  ● Redis     tyk-redis   6379→6379                   │ │
│  └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

**功能点：**
- Tyk Gateway Docker 容器运行状态（通过 dockerode `container.inspect()`）
- 启动/停止/重启（确认弹窗，操作后轮询状态直到完成）
- 操作历史（最近操作的 Timeline）
- 降级行为：Docker 管理服务不可达时，按钮变灰色 + 提示「Docker 管理服务不可用」，不影响仪表板和 API 管理

#### 4.2.3 🔌 服务管理（API Definitions）

沿用原设计文档的 Tab 分区方案，但 v1 表单**简化为核心字段**：

| Tab | v1 覆盖字段 |
|-----|------------|
| 基本信息 | name, api_id, active, tags |
| 路由配置 | proxy.listen_path, proxy.target_url, proxy.strip_listen_path, domain |
| 认证配置 | use_keyless, auth.auth_header_name, use_basic_auth, enable_jwt |
| 速率限制 | rate, per, disable_rate_limit |
| CORS | 全部 CORS 字段 |
| 缓存 | enable_cache, cache_timeout |

> 详细字段映射见原设计文档（Tab 1-6）。Tab 7-10（高级设置/版本管理/端点配置/详细日志）划入 v2。

#### 4.2.4 🔑 密钥管理

沿用原设计文档方案，v1 完整覆盖。

#### 4.2.5 ⚙ 设置

| 设置项 | 说明 |
|--------|------|
| Tyk Gateway 地址 | 如 `http://localhost:8080` |
| API Secret | `x-tyk-authorization` Header 值 |
| Docker 管理服务地址 | 默认 `http://localhost:3001` |
| 轮询间隔 | 默认 10s |
| 测试连接 | 验证 Tyk Gateway 连通性 |

---

## 五、降级策略

各数据源不可达时的行为定义：

| 故障场景 | 仪表板 | 网关管理页 | API 管理 | 密钥管理 |
|---------|:------:|:--------:|:------:|:------:|
| Tyk Gateway 不可达 | 全局 Banner 提示 + 数据清空 + 15s 自动重试 | 不受影响（走 Docker 服务） | 列表为空 + 全局错误提示 | 列表为空 + 全局错误提示 |
| Docker 管理服务不可达 | 不受影响（走 Tyk API） | 灰色按钮 + 提示「Docker 管理服务不可用」 | 不受影响 | 不受影响 |
| 两服务均不可达 | 全局 Banner 提示 | 灰色按钮 + 提示「Docker 管理服务不可用」 | 列表为空 + 全局错误提示 | 列表为空 + 全局错误提示 |

**恢复行为**：服务恢复后，所有页面自动重连（Data Provider 内置重试），无需手动刷新。

---

## 六、全局错误处理

统一错误处理策略，确保用户知道发生了什么：

| 错误类型 | 处理方式 |
|---------|---------|
| Tyk API 调用失败 | Toast 错误提示 + 操作按钮可点击重试 |
| 网络超时 | 超时提示 + 重试按钮 + 自动重试（3次指数退避） |
| 401/403 Forbidden | 提示「请检查 API Secret 配置」+ 跳回设置页 |
| Docker 管理服务错误 | 网关管理页按钮灰色 + 提示 + 30s 自动重连 |
| 创建/编辑表单验证失败 | 表单字段标红 + 滚动到第一个错误字段 |
| 删除操作的级联影响 | 确认弹窗中显示被删除资源的关联信息 |

---

## 七、API Definition 字段完整性

| 分组 | 字段数 | v1 覆盖 |
|------|--------|:------:|
| 基础标识 | 6 | ✅ 全部 |
| 路由代理 | 6 | ✅ 核心 4 个 |
| 认证方式 | 10+ | ✅ 核心 6 个 |
| 速率限制 | 6 | ✅ 核心 4 个 |
| CORS | 9 | ✅ 全部 |
| 缓存 | 4 | ✅ 核心 2 个 |
| 端点配置 | 16 种 | ❌ v2 |
| 版本管理 | 10+ | ❌ v2 |
| 高级设置 | 15+ | ❌ v2 |
| 详细日志 | 6 | ❌ v2 |

> Schema 驱动方案见原设计文档第六章。v1 以硬编码表单 + 可扩展 schema 设计起步。

---

## 八、技术风险与应对

| 风险 | 应对 |
|------|------|
| Tyk Gateway API 字段繁多 | 分阶段实现，v1 仅核心字段，schema 驱动渐进补全 |
| Tyk Gateway OSS 无内置 analytics 查询 API | v1 不做日志查询，v2 借助 Tyk Pump → MongoDB + 查询服务 |
| `/tyk/reload/` 导致所有 API 短暂不可用 |...[truncated]
| Gateway 连接中断 | 健康检查失败时全局 Banner 提示 + 自动重试 |
| Docker 操作可能造成服务中断 | 启停前确认弹窗 + 操作后状态轮询 + 错误降级处理 |
| Tyk 不是标准 REST API | Refine Data Provider 层做适配，页面代码不关心 |
| Docker socket 权限 | 运行 dockerode 的 Node.js 进程需加入 docker 用户组 |

---

## 九、附录

### A. Tyk Gateway 常用端口

| 组件 | 默认端口 |
|------|---------|
| Tyk Gateway | 8080 |
| Tyk Dashboard（商业版） | 3000 |
| Redis | 6379 |
| MongoDB（Pump 存储） | 27017 |
| PostgreSQL | 5432 |
| Docker 管理服务 | 3001 |

### B. 相关 GitHub 仓库

| 项目 | 链接 |
|------|------|
| Tyk Gateway | https://github.com/TykTechnologies/tyk |
| Tyk Pump | https://github.com/TykTechnologies/tyk-pump |
| Tyk Operator (K8s) | https://github.com/TykTechnologies/tyk-operator |
| Tyk Sync (GitOps) | https://github.com/TykTechnologies/tyk-sync |
| Tyk Swagger Definitions | https://github.com/TykTechnologies/tyk-swagger-definitions |
| dockerode | https://github.com/apocas/dockerode |

### C. 参考文档

| 文档 | 链接 |
|------|------|
| Tyk Gateway API | https://tyk.io/docs/tyk-gateway-api |
| API Definition 对象 | https://tyk.io/docs/5.1/tyk-gateway-api/api-definition-objects/ |
| 详细日志记录 | https://tyk.io/docs/5.6/product-stack/tyk-gateway/basic-config-and-security/logging-api-traffic/detailed-recording/ |
| Analytics 记录字段 | https://tyk.io/docs/4.3/tyk-stack/tyk-pump/tyk-analytics-record-fields/ |
| Tyk Pump | https://github.com/TykTechnologies/tyk-pump |
| 健康检查 | https://tyk.io/docs/planning-for-production/ensure-high-availability/health-check |

### D. v1 实施计划

详见独立文档：`design/v1-implementation-plan.md`
