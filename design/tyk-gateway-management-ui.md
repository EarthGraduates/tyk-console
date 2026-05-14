# Tyk 网关服务配置与监控界面 — 设计方案

> 项目：ichse-asset-share-center
> 框架：Refine v5 + Ant Design + Supabase (Auth)
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
┌─────────────────────────────────────────────────────────────┐
│                    Refine UI (浏览器)                         │
│                                                             │
│  ⚡仪表板  🔌API管理  🔑密钥管理  📋日志  ⚙设置              │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Custom Data Provider                        ││
│  │  getList / getOne / create / update / deleteOne          ││
│  │  ↓ 直接调 Tyk Gateway API（x-tyk-authorization 身份验证） ││
│  └─────────────────────────────────────────────────────────┘│
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP (直连)
                    ┌──────▼──────┐
                    │ Tyk Gateway │ ←──→ Redis (运行时)
                    │ ( :8080 )   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ Tyk Pump    │ ──→ MongoDB (日志 + analytics)
                    └─────────────┘
```

**核心设计思路**：Refine 框架本身通过 **Data Provider** 模式抽象数据层。本项目的 Data Provider 直接调 Tyk Gateway 管理 API，不做多余的中间层。Tyk API 自身带有 `x-tyk-authorization` 身份验证，前端设置页配置网关地址 + Secret 存入 localStorage。

### 2.2 为何不需要后端代理

| 之前担心的点 | 实际处理方式 |
|-------------|------------|
| **API Secret 安全** | Tyk 的 `x-tyk-authorization` 本身就是设计给客户端用的，配置存在前端 localStorage 即可，v1 无高安全要求 |
| **Docker 管理** | v1 不包含。Tyk 容器启停手动操作，v2 如有需要再加 |
| **多数据源聚合** | v1 只调 Tyk API 一个数据源，不存在聚合问题 |
| **日志查询** | v1 日志查看划入 v2。Pump + MongoDB 的查询服务 v2 再做 |
| **逻辑封装** | create/update 后的 reload 可以在 Refine 的 Data Provider 的 `create`/`update` 方法里自动调用 |

### 2.3 Refine Data Provider → Tyk API 映射关系

Tyk Gateway 管理 API 不是标准 RESTful，但可以通过 Refine 自定义 Data Provider 做适配。

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
| `create` | `POST /tyk/apis/` + `GET /tyk/reload/` | 创建后自动重载 |
| `update` | `PUT /tyk/apis/{apiID}` + `GET /tyk/reload/` | 更新后自动重载 |
| `deleteOne` | `DELETE /tyk/apis/{apiID}` + `GET /tyk/reload/` | 删除后自动重载 |
| `getList` | `GET /tyk/keys/` | 列出密钥 |
| `create` | `POST /tyk/keys/create` | 创建密钥 |
| `update` | `PUT /tyk/keys/{keyId}` | 更新密钥 |
| `deleteOne` | `DELETE /tyk/keys/{keyId}` | 删除密钥 |

### 2.4 数据库定位

| 数据库 | 用途 | 部署方式 | v1 需要？ |
|--------|------|---------|:--------:|
| **Redis** | Tyk Gateway 运行时存储 | Tyk Docker 依赖 | ✅ 已部署 |
| **MongoDB** | Pump 日志存储 | 独立 Docker | ❌ v2 |
| **PostgreSQL** | v2 业务数据 | 独立 Docker | ❌ v2 |
| **Supabase** | 用户认证 | 在线服务 | ✅ 已集成 |

> v1 不需要额外部署任何数据库。Tyk Gateway + Redis 已就绪即可。

### 2.5 网关连接配置

配置存入前端 `localStorage`，设置页提供配置入口：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| Tyk Gateway 地址 | `http://localhost:8080` | Tyk Gateway 监听地址 |
| API Secret | — | `x-tyk-authorization` Header 值 |
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

### 3.2 v1 不覆盖（明确划给 v2）

| 功能 | 理由 |
|------|------|
| OAuth 客户端管理 | 配置复杂，使用场景少 |
| API 版本管理（version_data） | 高级功能，v1 先单版本跑通 |
| 自定义中间件/插件 | 需要写代码，不是 UI 配置操作 |
| 导入/导出 Swagger/OAS | 可选，v2 考虑 |
| 网关自身 tyk.conf 编辑 | 风险高，需谨慎设计 |
| 服务业务属性（机构/出入参/服务编码） | 这是 v2 的定位 |
| **Docker 管理（启停 Tyk）** | v1 手动管理，v2 如需再加 |
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
- 自动轮询刷新（可配置间隔）
- 一键重载按钮（`GET /tyk/reload/`）

#### 4.2.2 🔌 服务管理（API Definitions）

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

#### 4.2.3 🔑 密钥管理

沿用原设计文档方案，v1 完整覆盖。

#### 4.2.4 ⚙ 设置

| 设置项 | 说明 |
|--------|------|
| Tyk Gateway 地址 | 如 `http://localhost:8080` |
| API Secret | `x-tyk-authorization` Header 值 |
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
| Tyk Gateway OSS 无内置 analytics 查询 API | v1 不做日志查询，v2 借助 Tyk Pump → MongoDB + 查询服务 |
| 每次修改需 reload（短暂中断） | 自动 reload、加载状态指示 |
| Gateway 连接中断 | 健康检查失败时全局 Banner 提示 + 自动重试 |
| RawRequest/RawResponse 含敏感数据 | v2 后端查询服务负责脱敏，v1 不涉及 |
| Tyk 不是标准 REST API | Refine Data Provider 层做适配，页面代码不关心 |

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
