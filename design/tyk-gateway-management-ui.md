# Tyk 网关服务配置与监控界面 — 设计方案

> 项目：ichse-asset-share-center
> 框架：Refine v5 + Ant Design + Supabase (Auth)
> 后端代理：Node.js / Go (待定)
> 目标：构建一套完整的 Tyk API Gateway (OSS) 服务配置与监控管理界面

---

## 一、背景与目标

Tyk Gateway 是一个云原生的开源 API 网关（Go 语言），支持 REST/GraphQL/TCP/gRPC 协议。它本身暴露一套 RESTful 管理 API（端口 8080），但缺乏一套现代化、可视化的 Web 管理界面（官方 Dashboard 为商业化产品）。

本项目目标分为两个版本阶段：

### v1（纯工具层）
构建基于 Refine 框架的 **Tyk Gateway OSS 管理界面**，覆盖：
1. **网关管理** — 查看/启动/停止/重启 Tyk Gateway（Docker）容器
2. **服务配置** — API 定义的全生命周期管理（CRUD）
3. **密钥管理** — API Token 的创建、编辑、吊销
4. **监控面板** — 网关健康状态 + 各 API 运行指标
5. **日志查看** — 请求/响应出入参数的查看（通过 Tyk Pump → MongoDB）

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

```
┌────────────────────────────────────────────────────────────┐
│                    Refine UI (浏览器)                        │
│                                                            │
│  ⚡仪表板  🔌网关管理  🔌API管理  🔑密钥  📋日志  ⚙设置      │
└───────────────────────┬────────────────────────────────────┘
                        │ HTTP (仅调后端代理，不直连 Tyk)
┌───────────────────────▼────────────────────────────────────┐
│                 后端代理服务 (Backend Proxy)                  │
│                                                            │
│  • Tyk API Client    — 封装 Gateway API 调用               │
│  • Docker API Client — 启停/重启 Tyk 容器                   │
│  • Log Query Service — 查 MongoDB (Pump analytics 数据)     │
│  • Config Manager    — 网关连接配置/模板管理                │
│  • (v2预留) Business API — 业务数据接口                     │
└────┬──────────────┬──────────────┬─────────────────────────┘
     │              │              │
     ▼              ▼              ▼
Tyk Gateway    Docker Daemon   MongoDB
 (Docker)      (启停/状态)     (Pump 日志 + analytics)
     │                              ▲
     ▼                              │
  Redis         Tyk Pump ───────────┘
 (运行时)      (搬运 analytics 数据)
     │
     ▼
 PostgreSQL (本地 Docker)
 ┌─────────────────────────────┐
 │ • (v2) 服务基本信息          │
 │ • (v2) 出入参/机构/服务编码  │
 │ • (v2) 调用关系              │
 │ • (v2) 配置快照/审计日志     │
 └─────────────────────────────┘
```

### 2.2 为何需要后端代理服务（关键设计决策）

| 原因 | 说明 |
|------|------|
| **安全性** | Tyk API Secret 存在前端不安全；后端代理统一管理凭证 |
| **Docker 管理** | Docker API 不能从浏览器直接调用 |
| **多数据源聚合** | 日志查 MongoDB、业务查 PostgreSQL、网关状态查 Docker — 前端只需对代理一个地址 |
| **逻辑封装** | 创建 API 后自动 reload、密钥脱敏、日志解码等逻辑统一在后端处理 |
| **v2 扩展** | 业务 API 接入无需改前端架构 |

### 2.3 通信层设计

```
┌───────────────────────────────────────────────┐
│            Refine Custom Data Provider          │
│   (不是直连 Tyk，而是连后端代理的 REST API)       │
└───────────────────┬───────────────────────────┘
                    │
┌───────────────────▼───────────────────────────┐
│           后端代理 API 路由                        │
│                                                │
│  GET/POST/PUT/DELETE /api/tyk/apis/*           │
│  GET/POST/PUT/DELETE /api/tyk/keys/*           │
│  GET               /api/tyk/health             │
│  POST              /api/tyk/reload             │
│  GET               /api/gateway/status         │ (Docker 容器状态)
│  POST              /api/gateway/start          │
│  POST              /api/gateway/stop           │
│  POST              /api/gateway/restart        │
│  GET               /api/logs                   │ (查 MongoDB)
│  GET               /api/logs/{id}              │ (单条详情)
│  GET/PUT           /api/config                 │ (连接配置)
│  POST              /api/config/test            │ (测试连接)
└───────────────────┬───────────────────────────┘
                    │
                    ▼
     ┌─────────────────────────────┐
     │  Tyk Gateway ( :8080 )      │
     │  Docker Daemon ( :2375 )    │
     │  MongoDB ( :27017 )          │
     │  PostgreSQL ( :5432 )        │
     └─────────────────────────────┘
```

### 2.4 Tyk Gateway API 映射关系

所有 Tyk Gateway API 调用**经后端代理转发**，不直接从浏览器调用。

| 资源 | Refine Action | 后端代理路径 | Tyk 目标端点 |
|------|-------------|-------------|-------------|
| apis | `getList` | `GET /api/tyk/apis/` | `GET /tyk/apis/` |
| apis | `getOne` | `GET /api/tyk/apis/:apiID` | `GET /tyk/apis/{apiID}` |
| apis | `create` | `POST /api/tyk/apis/` | `POST /tyk/apis/` + reload |
| apis | `update` | `PUT /api/tyk/apis/:apiID` | `PUT /tyk/apis/{apiID}` + reload |
| apis | `deleteOne` | `DELETE /api/tyk/apis/:apiID` | `DELETE /tyk/apis/{apiID}` + reload |
| keys | `getList` | `GET /api/tyk/keys/` | `GET /tyk/keys/` |
| keys | `getOne` | `GET /api/tyk/keys/:keyId` | — (暂不需要) |
| keys | `create` | `POST /api/tyk/keys/create` | `POST /tyk/keys/create` |
| keys | `update` | `PUT /api/tyk/keys/:keyId` | `PUT /tyk/keys/{keyId}` |
| keys | `deleteOne` | `DELETE /api/tyk/keys/:keyId` | `DELETE /tyk/keys/{keyId}` |

### 2.5 数据库定位

| 数据库 | 用途 | 部署方式 | v1 必须？ |
|--------|------|---------|:-------:|
| **Redis** | Tyk Gateway 运行时存储（API 定义、会话、缓存） | Tyk 自带 Docker 依赖 | ✅ |
| **MongoDB** | Tyk Pump 写入 analytics 日志（含 RawRequest/RawResponse） | 独立 Docker 容器 | ✅ |
| **PostgreSQL** | v2 业务数据：服务基本信息、出入参、机构、服务编码、审计日志 | 独立 Docker 容器 | ❌（v2） |
| **Supabase** | 用户认证（在线服务） | 已集成 | ✅ |

> PostgreSQL v2 才需要，v1 不部署，但架构预留接入点。

### 2.6 网关连接配置

页面提供**配置入口**（后端代理存储），让用户填写：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| Tyk Gateway 地址 | `http://localhost:8080` | Tyk Gateway 监听地址 |
| API Secret | — | `x-tyk-authorization` Header 值 |
| 后端代理端口 | `:3001` | 代理服务自身监听端口 |
| MongoDB 地址 | `mongodb://localhost:27017/tyk_analytics` | 日志数据源 |
| 轮询间隔 | `10s` | 监控数据自动刷新间隔 |

---

## 三、v1 功能边界

### 3.1 v1 覆盖范围

#### 🟢 模块 A：网关仪表板（Gateway Dashboard）
| # | 功能 | 数据来源 | 说明 |
|---|------|---------|------|
| A1 | 网关运行状态展示（版本号、状态、Redis 连通性） | `GET /hello`（经代理转发） | status: pass/fail + version |
| A2 | API 健康指标列表（请求率/延迟/错误数） | `GET /tyk/health/` 遍历 | 每个 API 一张状态卡 |
| A3 | 一键重载网关 | 代理触发 reload | 确认弹窗 + 结果反馈 |

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

#### 🟢 模块 D：日志查看（Traffic Logs）
| # | 功能 | 数据来源 | 说明 |
|---|------|---------|------|
| D1 | 日志列表（时间/API/方法/路径/状态码/延迟/IP） | MongoDB（Pump → mongodb） | 分页列表 |
| D2 | 多维过滤：API / 时间范围 / 状态码 / 方法 / 密钥 / 路径 | 后端查询代理 | 时间范围必填（防全表扫描） |
| D3 | 请求详情（RawRequest → HTTP 原文） | MongoDB RawRequest(Base64) | 解码 + 语法高亮 |
| D4 | 响应详情（RawResponse → HTTP 原文） | MongoDB RawResponse(Base64) | 解码 + 语法高亮 |
| D5 | 延迟详情（total / upstream） | Latency 字段 | 直接展示 |
| D6 | 敏感信息脱敏（Authorization Header 值隐藏） | 后端处理 | 默认启用 |

#### 🟢 模块 E：网关管理（Gateway Lifecycle）
| # | 功能 | 数据来源 | 说明 |
|---|------|---------|------|
| E1 | 查看 Tyk Gateway 容器运行状态 | Docker API（经代理） | 运行中/已停止/重启中 |
| E2 | 启动/停止/重启 Tyk Gateway | Docker API（经代理） | 操作确认 + 状态反馈 |
| E3 | Tyk 连接配置管理 | 后端代理存储 | Gateway 地址 + Secret 配置页 |

### 3.2 v1 不覆盖（明确划给 v2）

| 功能 | 理由 |
|------|------|
| OAuth 客户端管理 | 配置复杂，使用场景少 |
| API 版本管理（version_data） | 高级功能，v1 先单版本跑通 |
| 自定义中间件/插件 | 需要写代码，不是 UI 配置操作 |
| 导入/导出 Swagger/OAS | 可选，v2 考虑 |
| 网关自身 tyk.conf 编辑 | 风险高，需谨慎设计 |
| 服务业务属性（机构/出入参/服务编码） | 这是 v2 的定位 |
| PostgreSQL 部署与集成 | v2 才需要 |
| 统计聚合图表（趋势/占比） | v1 只做原始日志展示 |

### 3.3 日志查询能力清单

Pump 写入 MongoDB 的 analytics 记录包含以下字段，v1 日志页应完整覆盖：

**查询过滤条件：**
- [x] 按 **API** 筛选（APIName / APIID）
- [x] 按 **时间范围** 筛选（TimeStamp）← 必填
- [x] 按 **HTTP 方法** 筛选（Method）
- [x] 按 **状态码范围** 筛选（ResponseCode）
- [x] 按 **密钥 ID** 搜索（APIKey）
- [x] 按 **请求路径** 搜索（Path）
- [x] 按 **来源 IP** 搜索（IPAddress）

**列表展示列：**
| 列 | 来源字段 | 说明 |
|----|---------|------|
| 请求时间 | TimeStamp | 格式化显示 |
| API 名称 | APIName | — |
| 方法 | Method | GET/POST/PUT/DELETE... |
| 路径 | Path | 解码后的路径 |
| 状态码 | ResponseCode | 带颜色指示（2xx/4xx/5xx） |
| 总延迟 | Latency.total | ms |
| 上游延迟 | Latency.upstream | ms |
| 密钥 ID | APIKey | 脱敏后 4 位 |
| 来源 IP | IPAddress | — |

**详情展开（点击单条日志）：**
| 区域 | 内容 | 处理方式 |
|------|------|---------|
| Request | RawRequest → HTTP 原文 | Base64 解码 + 语法高亮 |
| Response | RawResponse → HTTP 原文 | Base64 解码 + 语法高亮 |
| 延迟 | total / upstream / RequestTime | 数字展示 |
| Meta | APIVersion / OrgID / Tags / Geo | 格式化展示 |
| 敏感脱敏 | Authorization / Cookie / Set-Cookie | 自动隐藏值 |

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
│  📋 日志  │                                               │
│  ⚙ 设置   │                                               │
│          │                                               │
└──────────┴───────────────────────────────────────────────┘
```

### 4.2 页面详述

#### 4.2.1 ⚡ 仪表板（Dashboard Overview）

**数据来源：** 后端代理转发 `GET /hello` + `GET /tyk/health/` (遍历)

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
- 自动轮询刷新（可配置间隔）
- 一键重载按钮（`GET /tyk/reload/`）

#### 4.2.2 🔌 网关管理（Gateway Lifecycle）

**数据来源：** Docker API（经后端代理转发）

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
│  │  [▶ 启动] [⏹ 停止] [🔄 重启] [📋 日志]               │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  相关容器:                                            │ │
│  │  ● Redis     ○ tyk-redis   up 3d 12h  6379→6379     │ │
│  │  ● MongoDB   ○ tyk-mongo   up 3d 12h  27017→27017   │ │
│  └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

**功能点：**
- Tyk Gateway Docker 容器运行状态
- 启动/停止/重启操作（确认弹窗）
- 相关关联容器（Redis、MongoDB）状态一览
- 容器日志快速入口（v1 可选）

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

#### 4.2.5 📋 日志查看

整体沿用原设计文档方案，新增以下约束：

- 时间范围**必选**（防止扫全表）
- 支持 API 名称下拉选择（从已加载的 API 列表获取）
- RawRequest/RawResponse 超长时自动截断（>= 50KB）
- 敏感 Header 值默认脱敏（Authorization / Cookie / Set-Cookie / X-Api-Key）

#### 4.2.6 ⚙ 设置

| 设置项 | 说明 |
|--------|------|
| Tyk Gateway 地址 | 如 `http://localhost:8080` |
| API Secret | `x-tyk-authorization` Header 值 |
| MongoDB 连接串 | 如 `mongodb://localhost:27017/tyk_analytics` |
| 轮询间隔 | 默认 10s |
| 测试连接 | 验证 Tyk Gateway 连通性 |

---

## 五、API Definition 字段完整性

沿用原设计文档的 Schema 驱动方案。v1 只覆盖下列高频分组：

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

## 六、技术风险与应对

| 风险 | 应对 |
|------|------|
| Tyk Gateway API 字段繁多 | 分阶段实现，v1 仅核心字段，schema 驱动渐进补全 |
| Tyk Gateway OSS 无内置 analytics 查询 API | 借助 Tyk Pump → MongoDB + 后端查询服务 |
| 每次修改需 reload（中断服务） | 自动 reload、加载状态指示、downtime 提示 |
| Gateway 连接中断 | 健康检查失败时全局 Banner 提示 + 自动重试 |
| RawRequest/RawResponse 含敏感数据 | 后端代理自动脱敏（Authorization Header 值隐藏） |
| Docker 操作影响生产 | v1 仅管理本地开发环境 Docker，生产部署方案 v2 定 |
| Tyk 不是标准 REST API | 后端代理统一适配，前端不需要感知 |

---

## 七、附录

### A. Tyk Gateway 常用端口

| 组件 | 默认端口 |
|------|---------|
| Tyk Gateway | 8080 |
| Tyk Dashboard（商业版） | 3000 |
| Redis | 6379 |
| MongoDB（Pump 存储） | 27017 |
| PostgreSQL | 5432 |
| 后端代理服务 | 3001 |

### B. 相关 GitHub 仓库

| 项目 | 链接 |
|------|------|
| Tyk Gateway | https://github.com/TykTechnologies/tyk |
| Tyk Pump | https://github.com/TykTechnologies/tyk-pump |
| Tyk Operator (K8s) | https://github.com/TykTechnologies/tyk-operator |
| Tyk Sync (GitOps) | https://github.com/TykTechnologies/tyk-sync |
| Tyk Swagger Definitions | https://github.com/TykTechnologies/tyk-swagger-definitions |

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
