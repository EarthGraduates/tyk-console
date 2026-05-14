# ichse-asset-share-center — v1 实施与验证计划

> 设计文档：`design/tyk-gateway-management-ui.md`
> v1 架构：Refine v5 + Ant Design v5 + Supabase Auth，Data Provider 直调 Tyk Gateway API + 可暂停 reload
> Docker 管理：dockerode (Node.js Docker SDK) 极简管理服务
> v2 架构：v1 + PostgreSQL（业务数据）+ 后端业务服务
> 预计工期：总计约 10-12 天（含单元测试和降级处理）

---

## 整体 Stage 路线图

```
Stage 0 ─→ Stage 1 ─→ Stage 2 ─→ Stage 3 ─→ Stage 4 ─→ Stage 5
环境+DP   仪表板      Docker管理   API管理     密钥管理     集成验证
 1天       1.5天      +网关管理     3.5天       1.5天        1天
                                  ↑
                                含克隆/批量删除
```

> **调整理由**（来自双模型评审 P1）：Data Provider 提前到 Stage 0（不依赖 Docker 服务，写完后仪表板立即可见 Tyk 数据）；Docker 管理后移到 Stage 2（与网关管理页紧耦合）。v1 不包含：日志查看、PostgreSQL、OAuth、版本管理。

---

## Stage 0：环境确认 + Data Provider 基础（预计 1 天）

### 目标
确认 Tyk Gateway 可用，编写 Tyk Data Provider 基础层（apis + keys CRUD），验证 Refine 版本兼容。

### 任务清单

| # | 任务 | 产出 | 验收条件 |
|---|------|------|---------|
| 0.1 | 确认 Tyk Gateway 运行中 | — | `curl localhost:8080/hello` 返回 `status: "pass"` |
| 0.2 | 确认管理 API 可用 | — | `curl -H "x-tyk-authorization: <secret>" .../tyk/apis/` 返回 `[]` |
| 0.3 | 创建 keyless 测试 API 验证链路 | — | curl 创建 → 调通 → 删除 |
| 0.4 | 验证 Refine v5 + Ant Design v5 + React 19 版本兼容 | — | `npm run dev` 无报错，浏览器正常 |
| 0.5 | 确认 Supabase Auth 配置 | — | 登录/注册页面可访问 |
| 0.6 | 编写 Tyk Data Provider — apis CRUD | `src/providers/tyk-data-provider.ts` | 5 个 Action 正确映射到 Tyk 端点 |
| 0.7 | 编写 Tyk Data Provider — keys CRUD | 同上扩展 | 密钥 CRUD 正确映射 |
| 0.8 | Data Provider mock 单元测试 | `__tests__/tyk-data-provider.test.ts` | 5+ 测试用例全部通过 |

### Reload 策略实现

| 模式 | 行为 |
|------|------|
| **自动 reload**（默认） | `create`/`update`/`deleteOne` 后自动调 `/tyk/reload/` |
| **暂停自动 reload** | 关闭后不自动 reload，顶部 banner 显示「有 N 项未生效的更改，点击应用」，点击一次性 reload |
| **reload 状态指示** | 仪表板显示「上次 reload」时间和 reload 次数 |

### 验证

- [ ] `curl localhost:8080/hello` 正常
- [ ] Tyk 管理 API CRUD 均可用
- [ ] `npm run dev` 正常，Refine + Ant Design + React 19 无兼容性问题
- [ ] Data Provider 5 种 Action 正确调用，单元测试全部通过
- [ ] 自动 reload 模式正常工作
- [ ] 暂停 reload 后 banner 正确显示，点击一次性 reload 后批量生效

---

## Stage 1：仪表板（预计 1.5 天）

### 目标
实现网关仪表板页面：健康状态 + 统计卡片 + API 指标列表 + reload 开关 + 一键重载。

### 任务清单

| # | 任务 | 产出 | 验收条件 |
|---|------|------|---------|
| 1.1 | 网关状态卡片（版本/Redis/运行状态） | `src/components/health-card.tsx` | 从 `/hello` 获取，状态正确 |
| 1.2 | 全局统计卡片（API 总数/请求率/平均延迟） | 仪表板组件 | 从 `/tyk/apis/` 和 `/tyk/health/` 聚合 |
| 1.3 | API 健康指标列表（分页前 10 个，按需加载） | 仪表板表格 | 每行 API 含请求率/延迟/错误/状态指示 |
| 1.4 | 一键重载按钮 + reload 计数器 + 距上次 reload 时间 | 仪表板按钮 | 调 `/tyk/reload/` → 结果 + 计数器更新 |
| 1.5 | 「暂停自动 reload」开关 + banner「有 N 项未生效更改」 | 全局 Banner 组件 | 关闭后不 auto-reload，banner 正确计数 |
| 1.6 | 手动刷新按钮（默认不自动轮询） | refresh 按钮 | 仅手动触发或开启轮询后自动刷新 |
| 1.7 | 轮询刷新开关 + 配置间隔（默认 10s，用户手动开启） | `useInterval` hook | 开关生效 |

### 验证

- [ ] 页面打开时正确显示 Tyk 版本号和 Redis 状态
- [ ] Redis 异常时显示 ❌
- [ ] 统计卡片数字正确，API 增删后实时更新
- [ ] 一键重载成功且有反馈，计数器 +1
- [ ] 暂停 reload 后，创建 API 触发 banner「有 1 项未生效的更改」
- [ ] 点击 banner 批量 reload，所有更改一次性生效
- [ ] 默认不自动轮询（避免 N+1 请求），手动开启后轮询正常
- [ ] 轮询间隔配置生效

---

## Stage 2：Docker 管理服务 + 网关管理页（预计 1.5 天）

### 目标
搭建 Docker 管理服务（dockerode），实现网关管理页面（容器状态 + 启停控制 + 降级处理）。

### 任务清单

| # | 任务 | 产出 | 验收条件 |
|---|------|------|---------|
| 2.1 | 搭建 Docker 管理服务骨架 | `docker-manager/index.js` | `npm install dockerode express` 后可启动 |
| 2.2 | 实现 4 个 API 端点（status/start/stop/restart） | 同上 | curl 各端点正常 |
| 2.3 | dockerode mock 单元测试 | `docker-manager/__tests__/` | mock dockerode，验证状态转换 |
| 2.4 | 网关管理页面（状态 + 启停按钮 + 确认弹窗） | `src/pages/gateway/index.tsx` | 状态正确，启停可操作 |
| 2.5 | 降级处理（服务不可达 → 灰色按钮 + 提示） | 同上 | Docker 服务挂了按钮灰掉 + 不影响其他页面 |
| 2.6 | 操作后状态轮询（等容器完成启动/停止） | 同上 | 点击重启后显示「重启中」，完成后恢复正常 |
| 2.7 | 设置页面（Gateway 地址/Secret/Docker 地址，存 localStorage） | `src/pages/settings/index.tsx` | 配置可保存、测试连接可用 |

### Docker 管理服务 API

| 方法 | 路径 | 说明 | 返回示例 |
|------|------|------|---------|
| `GET` | `/api/gateway/status` | 容器运行状态 | `{ running: true, status: "Up 3 days", version: "v5.7.0" }` |
| `POST` | `/api/gateway/start` | 启动容器 | `{ ok: true, action: "start" }` |
| `POST` | `/api/gateway/stop` | 停止容器 | `{ ok: true, action: "stop" }` |
| `POST` | `/api/gateway/restart` | 重启容器 | `{ ok: true, action: "restart" }` |

### 验证

- [ ] Docker 管理服务 `node index.js` 可启动，4 个端点 curl 正常
- [ ] 单元测试 (mock dockerode) 全部通过
- [ ] 网关管理页正确显示容器运行/停止状态
- [ ] 停止容器 → 确认弹窗 → 容器停止 → 仪表板标记网关离线
- [ ] 启动容器 → 容器恢复 → 各页面恢复正常
- [ ] 重启过程中显示「重启中」状态
- [ ] Docker 管理服务不可达时，按钮灰色 + 提示「Docker 管理服务不可用」
- [ ] API 管理和仪表板在 Docker 服务挂了时不受影响
- [ ] 设置页可保存全部配置项，测试连接可用
- [ ] Secret 输入框为 password 类型，可选显示/隐藏

---

## Stage 3：API 服务管理（预计 3.5 天）

### 目标
实现 API Definition 的完整 CRUD（6 个 Tab 核心字段 + 克隆 + 批量删除 + 搜索）。

### 任务清单

| # | 任务 | 产出 | 验收条件 |
|---|------|------|---------|
| 3.1 | API 列表页（表格 + 搜索/筛选 + 多选删除） | `src/pages/apis/list.tsx` | 数据完整，筛选正常，批量删除可用 |
| 3.2 | 创建 API 表单 — 基本信息 + 路由配置 | `src/pages/apis/create.tsx` | Tab 1-2，字段正确提交 |
| 3.3 | 创建表单 — 认证配置 + 速率限制 | 同上扩展 | Tab 3-4，认证模式联动正确 |
| 3.4 | 创建表单 — CORS + 缓存 | 同上扩展 | Tab 5-6，CORS 全部 9 字段 |
| 3.5 | API 克隆功能（复制已有 API 到创建表单） | 列表页操作列 | 预填全部字段，用户可微调后创建 |
| 3.6 | 编辑 API 页面（预填 + 修改 + 提交） | `src/pages/apis/edit.tsx` | 预填正确，提交后触发 reload |
| 3.7 | 查看 API 详情（JSON 格式化只读） | `src/pages/apis/show.tsx` | 完整 JSON 展示 |
| 3.8 | 删除 API（确认弹窗 + 级联 reload） | 列表页操作列 | 删除后该 API 不可再访问 |
| 3.9 | 表单字段联动单元测试 | `__tests__/` | 认证方式切换后字段显隐正确 |

### 创建表单 — v1 覆盖字段

| Tab | 字段 |
|-----|------|
| 基本信息 | name, api_id, active, tags |
| 路由配置 | proxy.listen_path, proxy.target_url, proxy.strip_listen_path, domain |
| 认证配置 | use_keyless, auth.auth_header_name, use_basic_auth, enable_jwt |
| 速率限制 | rate, per, disable_rate_limit |
| CORS | 全部 9 个字段 |
| 缓存 | enable_cache, cache_timeout |

> 端点配置（16 种）、版本管理（10+）、高级设置（15+）划入 v2。

### 验证

- [ ] 创建一个 keyless API → curl 调网关可通
- [ ] 创建一个 Token 认证 API → 无密钥返回 401，有密钥返回 200
- [ ] 克隆已有 API → 创建表单预填所有字段，修改后成功创建
- [ ] 编辑上游 URL → 请求路由到新地址
- [ ] 编辑认证方式（keyless → Token）→ 原请求返回 401
- [ ] 启用/停用 API 正确工作
- [ ] 批量选中 3 个 API 一键删除 → 全部删除成功
- [ ] 搜索按名称/认证方式筛选正确
- [ ] 创建/编辑/删除后 reload 策略正确（见 Stage 0 验证）
- [ ] 表单字段联动单元测试通过

---

## Stage 4：密钥管理（预计 1.5 天）

### 目标
实现 API Token 的全生命周期管理（列表/创建/编辑/吊销 + 状态标签）。

### 任务清单

| # | 任务 | 产出 | 验收条件 |
|---|------|------|---------|
| 4.1 | 密钥列表页（表格 + 状态标签） | `src/pages/keys/list.tsx` | 数据正确，状态标签正确 |
| 4.2 | 创建密钥表单（授权 API + 配额/速率/过期） | `src/pages/keys/create.tsx` | 创建成功，可用密钥调 API |
| 4.3 | 编辑密钥表单 | `src/pages/keys/edit.tsx` | 预填正确 + 保存成功 |
| 4.4 | 吊销密钥（确认弹窗） | 列表页操作列 | 密钥不可再使用 |
| 4.5 | 密钥状态标签计算逻辑单元测试 | `__tests__/` | 有效/即将过期/已过期判定正确 |

### 验证

- [ ] 创建一个密钥分配给 API → 用该密钥 curl 可调通
- [ ] 修改密钥配额 → 达配额上限后请求被限
- [ ] 修改密钥速率 → 超过速率后返回 429
- [ ] 吊销密钥 → curl 返回 403
- [ ] 密钥过期后自动显示 🔴 状态
- [ ] 状态标签单元测试通过

---

## Stage 5：集成验证与发布（预计 1 天）

### 目标
完整走通所有 v1 功能，验证全局错误处理和降级策略，逐项验收。

### 验收清单（Owner 审核用）

#### 网关仪表板
- [ ] 网关版本 + Redis 状态展示正确
- [ ] 统计卡片（API 总数/请求率/平均延迟）正确
- [ ] 每个 API 健康指标列表展示正确（分页）
- [ ] 一键重载成功有反馈 + 计数器 + 距上次 reload 时间
- [ ] 「暂停 rel...[truncated]