# Tyk 网关服务配置与监控界面 — 设计方案

> 项目：ichse-asset-share-center
> 框架：Refine v5 + Ant Design + Supabase (Auth)
> 目标：构建一套完整的 Tyk API Gateway (OSS) 服务配置与监控管理界面

---

## 一、背景与目标

Tyk Gateway 是一个云原生的开源 API 网关（Go 语言），支持 REST/GraphQL/TCP/gRPC 协议。它本身暴露一套 RESTful 管理 API（端口 8080），但缺乏一套现代化、可视化的 Web 管理界面（官方 Dashboard 为商业化产品）。

本项目目标是基于 Refine 框架，构建一套**面向 Tyk Gateway OSS 版本的完整管理界面**，覆盖：

1. **服务配置** — API 定义的全生命周期管理（CRUD + 所有 API Definition 字段）
2. **密钥管理** — API Token 的创建、编辑、吊销
3. **监控面板** — 网关健康状态 + 各 API 运行指标
4. **日志查看** — 请求/响应出入参数的查看

> **设计原则：一切可配置。API 支持什么字段，页面就展示什么字段。不预设简化、不隐藏能力。**

---

## 二、Tyk Gateway API 映射关系

### 2.1 通信层设计

Tyk Gateway API 不是标准的 REST CRUD 接口，需要用**自定义 Data Provider** 做适配。

```
┌────────────────────────────────────────────────────────┐
│                    Refine UI                            │
│   ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│   │ APIs    │  │ Keys     │  │ Monitor  │  │ Logs   │ │
│   └────┬────┘  └────┬─────┘  └────┬─────┘  └───┬────┘ │
│        │            │              │             │      │
│   ┌────▼────────────▼──────────────▼─────────────▼──┐   │
│   │          Tyk Data Provider                      │   │
│   │  (自定义 Refine dataProvider)                    │   │
│   └─────────────────────┬──────────────────────────┘   │
│                         │ HTTP + x-tyk-authorization    │
└─────────────────────────┼──────────────────────────────┘
                          │
                  ┌───────▼────────┐
                  │  Tyk Gateway   │  ←→ Redis
                  │  (localhost:8080)│
                  └───────┬────────┘
                          │
                  ┌───────▼────────┐
                  │  Tyk Pump      │  → MongoDB / Elasticsearch (详细日志)
                  └────────────────┘
```

### 2.2 Data Provider 映射表

| Refine Action | Tyk Gateway Endpoint | 说明 |
|---|---|---|
| `getList` | `GET /tyk/apis/` | 列出所有 API 定义 |
| `getOne` | `GET /tyk/apis/{apiID}` | 获取单个 API 定义 |
| `create` | `POST /tyk/apis/` | 创建 API |
| `update` | `PUT /tyk/apis/{apiID}` | 覆盖更新 API |
| `deleteOne` | `DELETE /tyk/apis/{apiID}` | 删除 API + 自动 `/tyk/reload/` |

> 对 `keys` 资源做类似映射：`POST /tyk/keys/create` → create，`PUT /tyk/keys/{keyId}` → update，`DELETE /tyk/keys/{keyId}` → deleteOne

### 2.3 网关连接配置

页面需要提供**配置入口**，让用户填写：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| Gateway 地址 | `http://localhost:8080` | Tyk Gateway 监听地址 |
| API Secret | — | `x-tyk-authorization` Header 值 |
| 轮询间隔 | `10s` | 监控数据自动刷新间隔 |

配置持久化到 `localStorage` 或 Supabase 用户配置表。

---

## 三、页面规划

### 3.1 全局导航

```
┌──────────────────────────────────────────────────────────┐
│  ☰ ichse Tyk Manager               🔆 🌛  admin@xyz     │
├──────────┬───────────────────────────────────────────────┤
│          │                                               │
│  ⚡ 仪表板│   (主内容区)                                   │
│  🔌 服务  │                                               │
│  🔑 密钥  │                                               │
│  📋 日志  │                                               │
│  ⚙ 设置   │                                               │
│          │                                               │
└──────────┴───────────────────────────────────────────────┘
```

### 3.2 页面详述

#### 3.2.1 ⚡ 仪表板（Dashboard Overview）

**数据来源：** `GET /hello` + `GET /tyc/health/` (遍历 API)

**展示内容：**

```
┌──────────────────────────────────────────────────────────┐
│  Tyk Gateway: v5.x.x   ● 运行中    Redis: ● 正常        │
├──────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│ │  API 总数 │ │ 活跃 API  │ │ 请求/秒   │ │ 平均延迟     │ │
│ │    12    │ │    8     │ │  245.3   │ │   42ms       │ │
│ └──────────┘ └──────────┘ └──────────┘ └──────────────┘ │
├──────────────────────────────────────────────────────────┤
│  API 运行状态列表                                         │
│ ┌──────┬────────┬────────┬───────┬──────┬───────┬─────┐ │
│ │ 名称 │ 监听路径│ 上游URL │ 请求率 │ 延迟 │ 错误率│ 状态 │ │
│ ├──────┼────────┼────────┼───────┼──────┼───────┼─────┤ │
│ │ ...  │  ...   │  ...   │  ...  │ ...  │  ...  │ 🟢 │ │
│ └──────┴────────┴────────┴───────┴──────┴───────┴─────┘ │
│                                        ⟳ 自动刷新 (10s)  │
└──────────────────────────────────────────────────────────┘
```

**功能点：**
- 网关版本、运行状态、Redis 连通性（从 `/hello` 获取）
- 全局统计卡片（API 数量、活跃数、总请求速率、平均延迟）
- 每个 API 的健康指标列表（来自 `/tyk/health/`）
- 支持按状态筛选（正常/警告/异常）
- 自动轮询刷新（可配置间隔）
- 快速重载按钮（`GET /tyk/reload/`）

---

#### 3.2.2 🔌 服务管理（API Definitions）

**核心页面：** 列表 → 创建 → 详情/编辑

##### 列表页

| 列 | 说明 |
|---|---|
| 名称 | API 名称，可点击进入详情 |
| 监听路径 | `proxy.listen_path` |
| 上游 URL | `proxy.target_url` |
| 认证方式 | keyless / Token / JWT / OAuth2 / Basic / OpenID |
| 限流 | `rate/per` 展示 |
| 状态 | 🟢 活跃 / 🔴 停用 / ⚠ 配置异常 |
| 操作 | 编辑 / 删除 / 克隆 / 重载 |

**筛选与搜索：** 按名称、状态、认证方式筛选

##### 创建/编辑表单

表单按照 API Definition 的 JSON 结构**分层组织**，使用 Ant Design 的 Collapse/Tabs 分组。**所有字段均从 API Definition schema 自动推导，无硬编码缺省。**

**Tab 1 — 基本信息**
| 字段 | JSON Path | 类型 | 说明 |
|---|---|---|---|
| API 名称 | `name` | TextInput | 必填 |
| API ID | `api_id` | TextInput | 自动生成，可自行指定 |
| 组织 ID | `org_id` | TextInput | 默认自动 |
| 活跃状态 | `active` | Switch | 启用/停用 |
| 标签 | `tags` | Select (多选) | 自定义标签 |
| 描述/备注 | — | TextArea | 仅在 UI 侧存储（不写入定义） |

**Tab 2 — 路由配置**
| 字段 | JSON Path | 类型 |
|---|---|---|
| 监听路径 | `proxy.listen_path` | TextInput |
| 剥离路径前缀 | `proxy.strip_listen_path` | Switch |
| 上游 URL | `proxy.target_url` | TextInput |
| 保留 Host 头 | `proxy.preserve_host_header` | Switch |
| 域名绑定 | `domain` | TextInput |
| 忽略端点大小写 | `ignore_endpoint_case` | Switch |

**Tab 3 — 认证配置**
| 字段 | JSON Path | 类型 |
|---|---|---|
| 免认证访问 | `use_keyless` | Switch |
| 认证 Header 名称 | `auth.auth_header_name` | TextInput (默认 `Authorization`) |
| 支持从 Query 参数 | `auth.use_param` / `auth.param_name` | Switch + TextInput |
| 支持从 Cookie | `auth.use_cookie` / `auth.cookie_name` | Switch + TextInput |
| Basic Auth | `use_basic_auth` | Switch |
| JWT 认证 | `enable_jwt` | Switch |
| JWT 签名方式 | `jwt_signing_method` | Select (HMAC/RSA/ECDSA) |
| JWT 来源 | `jwt_source` | TextArea (公钥/证书) |
| OAuth2.0 | `use_oauth2` | Switch |
| OpenID | `use_openid` | Switch |
| 双向 TLS | `use_mutual_tls_auth` | Switch |
| mTLS 客户端证书 | `client_certificates` | TextArray |
| 上游证书映射 | `upstream_certificates` | KeyValue |
| 签名校验 | `enable_signature_checking` | Switch |
| HMAC 时钟偏差 | `hmac_allowed_clock_skew` | Number |

**Tab 4 — 速率限制与配额**
| 字段 | JSON Path | 类型 |
|---|---|---|
| 请求速率 | `rate` | Number (每秒/每分钟) |
| 时间窗口 | `per` | Number (秒) |
| 禁用限流 | `disable_rate_limit` | Switch |
| 禁用配额 | `disable_quota` | Switch |
| 全局速率限制 | `global_rate_limit.rate` / `global_rate_limit.per` | Number |
| 会话生命周期 | `session_lifetime` | Number (秒) |

**Tab 5 — 端点级配置（Extended Paths）**
| 配置区域 | 说明 |
|---|---|
| 白名单 | `extended_paths.white_list` — 仅允许访问的端点 |
| 黑名单 | `extended_paths.black_list` — 禁止访问的端点 |
| 忽略路径 | `extended_paths.ignore` — 透传不处理 |
| 端点追踪 | `extended_paths.track_endpoints` |
| 请求转换 | `extended_paths.transform` / `transform_headers` |
| 响应转换 | `extended_paths.transform_response` / `transform_response_headers` |
| URL 重写 | `extended_paths.url_rewrites` |
| 缓存 | `extended_paths.cache` |
| 请求验证 (JSON) | `extended_paths.validate_json` |
| 超时 | `extended_paths.hard_timeouts` |
| 熔断 | `extended_paths.circuit_breakers` |
| 方法转换 | `extended_paths.method_transforms` |
| 大小限制 | `extended_paths.size_limits` |
| 虚拟端点 | `extended_paths.virtual` |
| Mock 响应 | `extended_paths.mock_response` |

每个端点配置条目支持：`path` (端点路径)、`method` (HTTP 方法)、`action` 相关配置参数。

**Tab 6 — CORS**
| 字段 | JSON Path |
|---|---|
| 启用 CORS | `CORS.enable` |
| 允许的来源 | `CORS.allowed_origins` |
| 允许的方法 | `CORS.allowed_methods` |
| 允许的请求头 | `CORS.allowed_headers` |
| 暴露的响应头 | `CORS.exposed_headers` |
| 允许凭证 | `CORS.allow_credentials` |
| 预检缓存时间 | `CORS.max_age` |
| OPTIONS 透传 | `CORS.options_passthrough` |

**Tab 7 — 缓存**
| 字段 | JSON Path |
|---|---|
| 启用缓存 | `cache_options.enable_cache` |
| 缓存超时 | `cache_options.cache_timeout` |
| 缓存所有安全请求 | `cache_options.cache_all_safe_requests` |
| 缓存状态码 | `cache_options.cache_response_codes` |
| 上游缓存控制 | `cache_options.enable_upstream_cache_control` |

**Tab 8 — 高级设置**
| 字段 | JSON Path | 说明 |
|---|---|---|
| IP 白名单 | `allowed_ips` | TextArray |
| IP 黑名单 | `blacklisted_ips` | TextArray |
| 上下文变量 | `enable_context_vars` | Switch |
| 配置数据 | `config_data` | JSON Editor |
| 标签请求头 | `tag_headers` | TextArray（记录到日志） |
| 自定义中间件 | `custom_middleware_bundle` | TextInput |
| 请求/响应处理器 | `response_processors` | 配置列表 |
| 事件处理器 | `event_handlers.events` | JSON Editor |
| 不追踪 | `do_not_track` | Switch |
| 批处理请求 | `enable_batch_request_support` | Switch |
| 剥离认证数据 | `strip_auth_data` | Switch |

**Tab 9 — 版本管理**
| 字段 | JSON Path |
|---|---|
| 启用版本 | `version_data.not_versioned` (false = 启用) |
| 版本位置 | `definition.location` (header/url/url-param) |
| 版本标识 | `definition.key` |
| 默认版本 | `version_data.default_version` |
| 版本列表 | 动态添加：版本名 + 过期时间 + 路径覆盖 |

**Tab 10 — 详细日志配置**
| 字段 | JSON Path |
|---|---|
| 启用详细记录 | `enable_detailed_recording` | Switch |
| 详细活动日志 | `detailed_activity` | Switch |
| Uptime 测试 | `uptime_tests` | 配置项列表 |

> 表单设计原则：每个 Tab 为一个 Ant Design Collapse Panel 或 TabPane；字段标注 JSON Path 方便高级用户对照文档；所有字段初始值对应 API Definition 的零值/默认值。

---

#### 3.2.3 🔑 密钥管理（API Keys）

**列表页：**

| 列 | 说明 |
|---|---|
| Key ID | 令牌 ID（可点击） |
| 关联 API | 此密钥被授权访问的 API 列表（Tag 展示） |
| 配额 | 已用/总量 |
| 速率 | 当前速率限制 |
| 过期时间 | 过期日期 |
| 状态 | 🟢 有效 / 🟡 即将过期 / 🔴 已过期 |
| 操作 | 编辑 / 吊销 / 刷新 |

**创建/编辑表单：**

| 字段 | JSON Path | 说明 |
|---|---|---|
| 授权 API | `access_rights` | 关联到哪些 API + 各 API 的版本/端点权限 |
| 配额 | `quota_max` / `quota_renews` / `quota_remaining` | 请求配额 |
| 速率 | `rate` / `per` | 速率限制 |
| 过期时间 | `expires` | UNIX 时间戳 |
| 别名 | `alias` | 可读标识 |
| 详细记录 | `enable_detailed_recording` | 仅此密钥启用详细记录 |
| Meta 数据 | `meta_data` | JSON 自定义元数据 |
| Tags | `tags` | 标签 |

---

#### 3.2.4 📋 日志查看（Traffic Logs）

这是请求/响应出入参数的查看功能。

##### 数据流架构

```
Tyk Gateway
   └─ enable_analytics: true
   └─ 各 API enable_detailed_recording: true
         ↓ 写入 analytics data（含 RawRequest/RawResponse）
   ┌──── Redis (临时缓冲) ────┐
         ↓
   ┌──── Tyk Pump ──────────────┐
   │   MongoDB / Elasticsearch   │
   └─────────────────────────────┘
         ↓
   ┌──── Log Query Service ────┐
   │   (Node.js / Python 轻量API) │
   │   GET /api/logs?api_id=&    │
   │   time_from=&time_to=&      │
   │   key_id=&method=&status=   │
   └──────────┬──────────────────┘
              │
         Refine UI (日志页)
```

##### 页面设计

```
┌──────────────────────────────────────────────────────────┐
│  📋 流量日志                                             │
│  ┌──────────────过滤条件────────────────────────────────┐ │
│  │ API: [▼ 全部 ▼]  状态码: [▼ 全部 ▼]  方法: [GET POST] │ │
│  │ 时间: [2026-05-09 14:00 ── 2026-05-09 15:00]       │ │
│  │ 密钥: [输入Key ID]  路径: [输入路径]                  │ │
│  │ [查询] [重置]                                         │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌──── 请求记录列表 ──────────────────────────────────┐  │
│  │ 时间 │ API │ 方法 │ 路径 │ 状态 │ 延迟 │ 密钥 │ 来源IP │ │
│  │ 14:32│ Pet │ GET  │/v2/pet│ 200 │ 23ms │ **** │ 10.0.0.1│ │
│  │ 14:31│ Pet │ POST │/v2/pet│ 201 │ 45ms │ **** │ 10.0.0.1│ │
│  │ ...                                                    │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌──── 请求详情（点击展开/Panel）────────────────────────┐ │
│  │                                                        │ │
│  │ 🔹 Request                                            │ │
│  │  ┌─────────────────────────────────────────────────┐  │ │
│  │  │ GET /v2/pet HTTP/1.1                            │  │ │
│  │  │ Host: petstore.swagger.io                       │  │ │
│  │  │ Authorization: Bearer ***                       │  │ │
│  │  │ Content-Type: application/json                  │  │ │
│  │  │                                                  │  │ │
│  │  │ {"name": "Fluffy", "category": "cat"}           │  │ │
│  │  └─────────────────────────────────────────────────┘  │ │
│  │                                                        │ │
│  │ 🔹 Response                                           │ │
│  │  ┌─────────────────────────────────────────────────┐  │ │
│  │  │ HTTP/1.1 201 Created                            │  │ │
│  │  │ Content-Type: application/json                  │  │ │
│  │  │                                                  │  │ │
│  │  │ {"id": 42, "name": "Fluffy", "status": "avail"} │  │ │
│  │  └─────────────────────────────────────────────────┘  │ │
│  │                                                        │ │
│  │ 🔹 Metadata                                           │ │
│  │  │ 延迟(总): 45ms | 上游延迟: 42ms | API: Petstore  │ │
│  │  │ 客户端IP: 10.0.0.1 | 密钥: 4309****a1f2          │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

详细信息从 `RawRequest` / `RawResponse`（Base64 编码的 HTTP 请求/响应原文）解码展示。

##### 日志配置页面

在设置中（或 API 编辑页的日志 Tab）提供详细记录配置：

| 配置项 | 范围 | 说明 |
|---|---|---|
| 启用详细记录 | 全局 / 按API / 按密钥 | 三级控制（Gateway → API → Key） |
| Pump 存储类型 | MongoDB / Elasticsearch / CSV | 选择后端存储 |
| Pump 连接字符串 | — | 如 `mongodb://localhost:27017/tyk_analytics` |
| 日志保留天数 | Number | 自动过期清理 |
| 日志查询服务地址 | — | 轻量查询 API 端点 |

---

#### 3.2.5 ⚙️ 系统设置

| 配置区域 | 说明 |
|---|---|
| 网关连接 | Gateway URL + Secret（测试连接按钮） |
| 监控轮询 | 间隔秒数、是否自动刷新 |
| 日志配置 | Pump 存储后端配置、保留策略 |
| 主题设置 | 深色/浅色模式（已有） |
| 语言 | （预留） |

---

## 四、技术实现

### 4.1 自定义 Tyk Data Provider

Refine 要求 data provider 实现 5 个核心方法 + 可选方法：

```typescript
// src/providers/tyk-data-provider.ts
import { DataProvider } from "@refinedev/core";

const tykDataProvider = (gatewayUrl: string, secret: string): DataProvider => ({
  getList: async ({ resource, pagination, filters, sorters }) => {
    // GET /tyk/{resource}/
    const response = await fetch(`${gatewayUrl}/tyk/${resource}/`, {
      headers: { "x-tyk-authorization": secret },
    });
    const body = await response.json();
    return { data: body, total: body.length };
  },

  getOne: async ({ resource, id }) => {
    // GET /tyk/{resource}/{id}
    const response = await fetch(`${gatewayUrl}/tyk/${resource}/${id}`, {
      headers: { "x-tyk-authorization": secret },
    });
    return { data: await response.json() };
  },

  create: async ({ resource, variables }) => {
    let endpoint = `/tyk/${resource}/`;
    if (resource === "keys") endpoint = `/tyk/keys/create`;
    const response = await fetch(`${gatewayUrl}${endpoint}`, {
      method: "POST",
      headers: { "x-tyk-authorization": secret, "Content-Type": "application/json" },
      body: JSON.stringify(variables),
    });
    // 创建后自动重载
    await fetch(`${gatewayUrl}/tyk/reload/`, {
      headers: { "x-tyk-authorization": secret },
    });
    return { data: await response.json() };
  },

  update: async ({ resource, id, variables }) => {
    // PUT /tyk/{resource}/{id}
    // ...
  },

  deleteOne: async ({ resource, id }) => {
    // DELETE /tyk/{resource}/{id} + reload
    // ...
  },
});
```

### 4.2 Supabase Auth 集成

Refine 项目已内置 Supabase Auth Provider。我们将把 Tyk Management UI 作为**受保护应用**：

- 用户需登录（通过 Supabase Auth）才能访问
- 网关连接凭据（Gateway URL + Secret）可存储在：
  - **Option A:** 每个用户的 Supabase 配置表（多租户）
  - **Option B:** 环境变量 + 全局配置页（单实例部署）
- 推荐 Option A + 默认值回退到 Option B

### 4.3 关键组件清单

| 组件 | 用途 | 来自 |
|---|---|---|
| `<List>`, `<Table>` | API 及密钥列表 | @refinedev/antd |
| `<Form>`, `<Create>`, `<Edit>` | 配置表单 | @refinedev/antd |
| `<Tag>`, `<Badge>` | 状态/标签展示 | antd |
| `<Collapse>`, `<Tabs>` | 表单分区 | antd |
| `<Modal>`, `<Drawer>` | JSON 详情展示 | antd |
| `<Timeline>` | 重载/操作记录 | antd |
| `<Statistic>`, `<Card>` | 仪表板统计 | antd |
| `<Chart>` (recharts) | 请求趋势图 | 额外引入 |
| `<CodeBlock>` | RawRequest/RawResponse 展示 | react-syntax-highlighter |
| `<ConfigProvider>` | 全局配置页 | antd |

### 4.4 目录结构规划

```
src/
├── App.tsx                          # 主入口，路由定义
├── providers/
│   ├── auth.ts                      # 已有 Supabase Auth
│   ├── tyk-data-provider.ts         # ⭐ 自定义 Tyk Data Provider
│   ├── tyk-health-provider.ts       # 健康检查数据获取
│   ├── tyk-log-provider.ts          # 日志查询 Data Provider
│   └── tyk-config.ts                # 网关连接配置（Context + Hook）
├── pages/
│   ├── dashboard/
│   │   └── index.tsx                # 仪表板
│   ├── apis/
│   │   ├── list.tsx                 # API 列表
│   │   ├── create.tsx               # 创建 API
│   │   ├── edit.tsx                 # 编辑 API
│   │   └── show.tsx                 # API 详情
│   ├── keys/
│   │   ├── list.tsx
│   │   ├── create.tsx
│   │   ├── edit.tsx
│   │   └── show.tsx
│   ├── logs/
│   │   └── index.tsx                # 日志查询页
│   └── settings/
│       └── index.tsx                # 系统设置页
├── components/
│   ├── header/
│   │   └── index.tsx                # 已有 Header
│   ├── tyk-form/
│   │   ├── basic-info.tsx           # Tab 组件: 基本信息
│   │   ├── routing.tsx              # Tab: 路由配置
│   │   ├── auth-config.tsx          # Tab: 认证配置
│   │   ├── rate-limit.tsx           # Tab: 限流配额
│   │   ├── extended-paths.tsx       # Tab: 端点配置
│   │   ├── cors.tsx                 # Tab: CORS
│   │   ├── caching.tsx              # Tab: 缓存
│   │   ├── advanced.tsx             # Tab: 高级设置
│   │   ├── versioning.tsx           # Tab: 版本管理
│   │   └── detailed-logging.tsx     # Tab: 详细日志
│   ├── health-card.tsx              # 健康状态卡片
│   ├── status-badge.tsx             # 状态指示器
│   ├── log-detail-panel.tsx         # 请求/响应详情面板
│   └── code-viewer.tsx              # Base64 解码展示
├── contexts/
│   ├── color-mode/                  # 已有
│   └── tyk-config.tsx               # 网关配置上下文
└── lib/
    ├── tyk-api.ts                   # Tyk API 辅助函数
    ├── schema-fields.ts             # API Definition 字段定义（用于动态表单）
    └── base64-decoder.ts            # RawRequest/Response 解码
```

### 4.5 关于 OAS API 支持

Tyk 同时提供 Classic API 和 OAS API 两种定义格式。本界面优先覆盖 **Classic API**（兼容性最强、文档最全），后续可根据需要扩展 OAS API Tab：

```
POST /tyk/apis/oas          → 用 OAS 3.0 格式创建
GET  /tyk/apis/oas/{id}     → 查看 OAS API
PATCH /tyk/apis/oas/{id}    → 更新 OAS API
```

在 API 列表中对两种类型加 Badge 区分：`[Classic]` / `[OAS]`

---

## 五、API Definition 字段完整性

为了确保**一切可配置**，我们以 Tyk Classic API Definition 的完整 JSON Schema 作为数据驱动，动态生成表单。以下是所有支持字段的分组总表（参考 Tyk v5.x）：

| 分组 | 字段数 | 路径示例 |
|---|---|---|
| 基础标识 | 6 | `name`, `api_id`, `org_id`, `slug`, `tags`, `active` |
| 路由代理 | 8 | `proxy.listen_path`, `proxy.target_url`, `domain` |
| 认证方式 | 30+ | `use_keyless`, `auth.*`, `enable_jwt`, `jwt_source` |
| 速率限制 | 8 | `rate`, `per`, `global_rate_limit.*` |
| 端点配置 | 16种 | `extended_paths.white_list`, `extended_paths.transform` |
| CORS | 9 | `CORS.*` |
| 缓存 | 6 | `cache_options.*` |
| 高级 | 15+ | `config_data`, `custom_middleware`, `event_handlers` |
| 版本管理 | 10+ | `version_data.*`, `definition.*` |
| 日志/监控 | 6 | `enable_detailed_recording`, `tag_headers` |
| TLS/证书 | 5 | `upstream_certificates`, `client_certificates` |
| **总计** | **~120+ 字段** | |

> 表单实现策略：先覆盖高频字段（Tab 1-6），再逐步扩展完整字段。每个字段通过 JSON Schema 自动渲染，新增字段只需补充 schema 定义，无需修改页面代码。

---

## 六、API 字段 JSON Schema 驱动方案

对于认证等配置复杂的区域，采用 **Schema 驱动渲染**：

```typescript
// schema-fields.ts
export const API_DEFINITION_SCHEMA = {
  auth: {
    type: "group",
    label: "认证配置",
    fields: [
      { key: "use_keyless", type: "switch", label: "免认证访问" },
      { key: "auth.auth_header_name", type: "text", label: "认证 Header 名称", default: "Authorization" },
      { key: "auth.use_param", type: "switch", label: "支持 Query 参数" },
      // ... 所有字段按 JSON Path 映射
    ],
  },
  // ...
};
```

这样当 Tyk 新增 API Definition 字段时，只需更新 schema 配置，无需改页面代码。

---

## 七、开发实施计划

### Stage 1：基础设施（预计 2-3 天）

| 任务 | 产出 |
|---|---|
| ① 创建 Tyk Data Provider | `src/providers/tyk-data-provider.ts` — 实现 5 个核心 CRUD 方法 |
| ② 网关配置上下文 | Tyk 连接状态管理、测试连接功能 |
| ③ 基础布局 + 路由 | 侧边栏导航、页面路由注册 |
| ④ 设置页 | 网关地址 + Secret 输入、测试连接 |

### Stage 2：API 服务管理 CRUD（预计 4-5 天）

| 任务 | 产出 |
|---|---|
| ① API 列表页 | 表格、搜索、筛选、排序、状态指示 |
| ② 创建表单（核心字段） | 基本信息 + 路由 + 认证 + 限流 |
| ③ 创建表单（进阶字段） | 端点配置 + CORS + 缓存 + 高级 + 日志 |
| ④ 编辑/详情页 | 修改已有 API 定义、查看完整配置 |
| ⑤ 删除 + 重载联动 | 删除确认、自动重载、错误处理 |

### Stage 3：密钥管理（预计 2 天）

| 任务 | 产出 |
|---|---|
| ① 密钥列表 + 搜索 | 关联 API 标签展示、状态指示 |
| ② 密钥创建/编辑 | 授权 API 选择、配额/速率设置、过期时间 |
| ③ 密钥吊销 | 删除确认 + 即时生效 |

### Stage 4：监控面板（预计 2 天）

| 任务 | 产出 |
|---|---|
| ① 网关健康状态 | `/hello` 数据展示、Redis 状态、版本信息 |
| ② API 运行指标 | `/tyk/health/` 数据遍历展示、状态卡片 |
| ③ 自动轮询 | 可配置间隔刷新、刷新控制按钮 |
| ④ 快速重载 | 一键重载 + 操作日志（Timeline） |

### Stage 5：日志查看（预计 3-4 天）

| 任务 | 产出 |
|---|---|
| ① 详细记录配置界面 | 全局/按API/按密钥三级配置 |
| ② Pump 存储后端连接 | 配置 MongoDB / ES 连接 |
| ③ 日志查询 API | 轻量查询服务（Node.js 或 Python） |
| ④ 日志查看页面 | 列表 + 过滤 + RawRequest/RawResponse 解码展示 |
| ⑤ Base64 解码 + HTTP 格式化 | 请求/响应原文展示、语法高亮 |

---

## 八、技术风险与应对

| 风险 | 应对 |
|---|---|
| Tyk Gateway 的 API Definition 字段繁多（120+） | 分阶段实现，优先核心字段，Schema 驱动 + 渐进式补全 |
| Tyk Gateway OSS 无内置 analytics 查询 API | 借助 Tyk Pump + MongoDB/ES + 自定义查询服务 |
| 每次修改需 reload 才能生效 | 自动 reload + 加载状态指示 + 错误处理 |
| Gateway 连接中断 | 健康检查失败时全局提示 + 重试机制 |
| RawRequest/RawResponse 可能包含敏感数据 | 脱敏显示（可隐藏 Authorization Header 值） |

---

## 九、附录

### A. Tyk Gateway 常用端口

| 组件 | 默认端口 |
|---|---|
| Tyk Gateway | 8080 |
| Tyk Dashboard (商业版) | 3000 |
| Redis | 6379 |
| MongoDB (Pump 存储) | 27017 |
| Elasticsearch (Pump 存储) | 9200 |

### B. 相关 GitHub 仓库

| 项目 | 链接 |
|---|---|
| Tyk Gateway | https://github.com/TykTechnologies/tyk |
| Tyk Pump | https://github.com/TykTechnologies/tyk-pump |
| Tyk Operator (K8s) | https://github.com/TykTechnologies/tyk-operator |
| Tyk Sync (GitOps) | https://github.com/TykTechnologies/tyk-sync |

### C. 参考文档

| 文档 | 链接 |
|---|---|
| Tyk Gateway API | https://tyk.io/docs/tyk-gateway-api |
| API Definition 对象 | https://tyk.io/docs/5.1/tyk-gateway-api/api-definition-objects/ |
| 详细日志记录 | https://tyk.io/docs/5.6/product-stack/tyk-gateway/basic-config-and-security/logging-api-traffic/detailed-recording/ |
| Analytics 记录字段 | https://tyk.io/docs/4.3/tyk-stack/tyk-pump/tyk-analytics-record-fields/ |
| Tyk Pump | https://github.com/TykTechnologies/tyk-pump |
| 健康检查 | https://tyk.io/docs/planning-for-production/ensure-high-availability/health-check |
