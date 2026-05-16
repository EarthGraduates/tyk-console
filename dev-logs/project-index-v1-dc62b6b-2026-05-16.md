# 项目索引 — v1

> **版本**：`dc62b6b` | **日期**：2026-05-16
> **项目**：ichse-asset-share-center — Tyk Gateway OSS 管理界面
> **仓库**：git@github.com:EarthGraduates/ichse-asset-share-center.git

---

## 一、版本信息

| 项 | 值 |
|----|-----|
| Git commit | `dc62b6b` |
| 版本阶段 | v1 开发中 |
| 框架 | Refine v5.0.8 + Ant Design v5.23.0 + React 19.1.0 |
| Node | ≥18 |
| 包管理 | npm |

---

## 二、模块结构

```
ichse-asset-share-center/
├── src/
│   ├── App.tsx                          — 应用入口，Provider/路由/资源注册
│   ├── index.tsx                        — DOM 挂载
│   ├── vite-env.d.ts                    — Vite 类型声明
│   │
│   ├── providers/                       — 数据/认证层
│   │   ├── tyk-data-provider.ts         — ★ Tyk Gateway Data Provider（核心）
│   │   ├── data.ts                      — 双 Provider 导出（Supabase + Tyk）
│   │   ├── auth.ts                      — Supabase AuthProvider（登录/注册/登出）
│   │   ├── supabase-client.ts           — Supabase 客户端单例
│   │   └── constants.ts                 — Supabase URL/Key 常量
│   │
│   ├── pages/                           — 页面组件
│   │   ├── dashboard/index.tsx          — ★ 仪表板（网关健康 + API 指标 + reload 控制）
│   │   ├── apis/index.tsx               — ★ API 管理（列表/创建 Modal/详情/克隆）
│   │   ├── keys/index.tsx               — ★ 密钥管理（列表/创建/编辑/吊销）
│   │   ├── settings/index.tsx           — 设置页（Gateway URL/Secret/Docker 地址）
│   │   └── gateway/index.tsx            — 网关管理（Docker 容器启停/状态）
│   │
│   ├── components/                      — 公共组件
│   │   ├── header/index.tsx             — Header 组件（模板代码，当前未使用）
│   │   └── index.ts                     — barrel 导出
│   │
│   └── contexts/                        — React Context
│       └── color-mode/index.tsx         — 亮暗主题切换（模板代码）
│
├── __tests__/                           — 测试
│   └── tyk-data-provider.test.ts        — Tyk Data Provider 单元测试（9 tests）
│
├── design/                              — 设计文档
│   ├── tyk-gateway-management-ui.md     — 设计方案（架构/页面/API 映射）
│   ├── v1-implementation-plan.md        — 实施计划（Stage 0-5）
│   └── review_20260514_0001/            — 双模型评审归档
│       ├── review_20260514_deepseek.md
│       ├── review_20260514_minimax.md
│       └── review_20260514_summary.md
│
├── dev-logs/                            — 开发日志
│   ├── 2026-05-16.md                    — 今日日志
│   ├── stage-0.md                       — Stage 0 执行日志
│   ├── stage-1-4.md                     — Stage 1-4 执行日志
│   └── v1-round1-summary.md             — 第一轮开发总结
│
├── eslint.config.js                     — ESLint 配置（阿里规约）
├── vite.config.ts                       — Vite 配置（含 Tyk API proxy）
├── vitest.config.ts                     — Vitest 测试配置
├── tsconfig.json                        — TypeScript 配置
├── tsconfig.node.json                   — Node 端 TS 配置
├── package.json                         — 依赖清单
├── index.html                           — Vite 入口 HTML
├── Dockerfile                           — 生产构建 Docker 镜像
├── .npmrc                               — npm 配置
├── public/favicon.ico                   — 网站图标
└── README.MD                            — 项目说明
```

---

## 三、各模块职责

### 3.1 核心：Data Provider

**文件**：`src/providers/tyk-data-provider.ts`（217 行）

**职责**：实现 Refine DataProvider 接口，通过 Tyk Gateway REST API 完成 CRUD。

| 资源 | 操作 | Tyk 端点 |
|------|------|---------|
| `apis` | getList | `GET /tyk/apis/` |
| `apis` | getOne | `GET /tyk/apis/{id}` |
| `apis` | create | `POST /tyk/apis/` |
| `apis` | update | `PUT /tyk/apis/{id}` |
| `apis` | deleteOne | `DELETE /tyk/apis/{id}` |
| `keys` | getList | `GET /tyk/keys/` → 逐条 `GET /tyk/keys/{id}` |
| `keys` | create | `POST /tyk/keys/create` |
| `keys` | update | `PUT /tyk/keys/{id}` |
| `keys` | deleteOne | `DELETE /tyk/keys/{id}?api_id=` |

**特殊机制**：
- **Reload 策略**：默认自动 reload，可切换暂停模式（banner 手动批量触发）
- **Secret 默认值**：`'foo'`（dev 环境 docker-compose 内置值）
- **Gateway URL 默认**：空字符串（走 Vite proxy 相对路径）
- **密钥列表**：Tyk 列表只返回 ID，需逐条查详情（N+1）

### 3.2 页面：仪表板

**文件**：`src/pages/dashboard/index.tsx`（230 行）

**数据来源**：
- `GET /hello` → 网关版本 + Redis 状态
- `GET /tyk/apis/` → API 列表
- `GET /tyk/health/?api_id=xxx` → 逐个 API 健康指标（前 10 个）

**功能**：
- 网关健康卡片（版本/Redis/运行状态）
- 统计卡片（API 总数/平均延迟/总请求数/Reload 次数）
- API 健康指标表格（延迟/请求/成功/错误/状态）
- 一键重载 + reload 计数器 + 距上次 reload 时间
- 暂停自动 reload 开关 + 未生效更改 banner
- 手动刷新 + 自动刷新开关（默认关闭，避免 N+1 问题）

### 3.3 页面：API 管理

**文件**：`src/pages/apis/index.tsx`（265 行）

**功能**：
- API 列表（名称/API ID/监听路径/上游/认证/状态/操作）
- 创建弹窗（6 Tab：基本信息/路由/认证/CORS/速率限制/缓存）
- 克隆 API（预填所有字段到创建弹窗）
- 删除 API（确认弹窗）
- 详情页（JSON 格式化展示）

**v1 覆盖字段**：~25 核心字段，高级设置划入 v2

### 3.4 页面：密钥管理

**文件**：`src/pages/keys/index.tsx`（217 行，⚠️ 编辑功能有 bug）

**功能**：
- 密钥列表（Key ID/授权 API/状态/配额/速率/有效期）
- 创建弹窗（授权 API 下拉 + 速率/配额/过期时间）
- 创建成功后展示密钥值（一次性查看，Tyk 不会返回两次）
- ⚠️ 编辑按钮崩溃（已回滚，待修复）
- 吊销（确认弹窗）

### 3.5 页面：网关管理

**文件**：`src/pages/gateway/index.tsx`（139 行）

**功能**：
- Docker 容器状态展示
- 启动/停止/重启（确认弹窗）
- ⚠️ Docker 管理服务未编写 → 当前处于降级状态

### 3.6 页面：设置

**文件**：`src/pages/settings/index.tsx`（92 行）

**功能**：
- Gateway URL / API Secret / Docker 地址配置
- Secret 输入框为 password 类型（可切换显示）
- 连接测试
- 所有配置存入 localStorage

---

## 四、关键配置文件

| 文件 | 用途 | 关键内容 |
|------|------|---------|
| `vite.config.ts` | 开发服务器 + Tyk API 代理 | proxy：`/tyk` `/hello` → `localhost:8080` |
| `eslint.config.js` | 阿里前端规约 | `eslint-config-ali` (base + react) |
| `vitest.config.ts` | 测试框架配置 | node 环境，`__tests__/**/*.test.ts` |
| `tsconfig.json` | TypeScript 编译配置 | strict，bundler 模式 |
| `package.json` | 依赖清单 | Refine v5, React 19, Ant Design v5 |
| `Dockerfile` | 生产构建 | Refine node 镜像 + serve |
| `index.html` | Vite 入口 | `<div id="root">` |

### 外部配置（不在本仓库）

| 位置 | 用途 |
|------|------|
| `~/Hermes/git-tyk/tyk-gateway-docker/docker-compose.yml` | Tyk Gateway + Redis 容器 |
| `~/Hermes/git-tyk/tyk-gateway-docker/tyk.standalone.conf` | Tyk 配置（hash_keys, enable_hashed_keys_listing） |
| `~/.hermes/config.yaml` | Hermes Agent 配置（模型/Provider） |

---

## 五、构建和运行命令

```bash
# ===== 环境启动 =====
colima start                                    # 启动 Docker 运行时
cd ~/Hermes/git-tyk/tyk-gateway-docker
docker-compose up -d                            # 启动 Tyk Gateway + Redis

# ===== 开发 =====
cd ~/Hermes/refine-projects/ichse-asset-share-center
npm run dev                                     # Vite dev server → http://localhost:5173
# 或
npx vite --host

# ===== 测试 =====
npx vitest run                                  # 运行单元测试（9 tests）
npx vitest                                      # watch 模式

# ===== 代码审查 =====
npx eslint src/                                 # 阿里规约检查
npx eslint src/ --fix                           # 自动修复

# ===== 构建 =====
npm run build                                   # 生产构建到 dist/
npm run preview                                 # 预览构建结果

# ===== Git =====
git add -A && git commit -m "..." && git push
```

---

## 六、测试策略

### 6.1 当前测试覆盖

| 文件 | 测试 | 覆盖率 |
|------|:----:|:------:|
| `__tests__/tyk-data-provider.test.ts` | 9 tests | Data Provider 核心逻辑 |

**覆盖场景**：getList(apis/keys)、create、delete、reload 策略切换、pendingChanges 计数

### 6.2 计划补充

| 模块 | 测试内容 | 优先级 |
|------|---------|:----:|
| Data Provider | keys CRUD 异常处理 | P1 |
| Data Provider | reload 失败降级 | P1 |
| Docker 管理服务 | status/start/stop mock | P2 |
| 仪表板 | 轮询逻辑 useInterval | P2 |
| 密钥表单 | 字段联动 | P2 |

### 6.3 端到端验收

详见 `design/v1-implementation-plan.md` Stage 5 验收清单。

---

## 七、依赖环境

| 依赖 | 版本 | 用途 |
|------|------|------|
| Colima | latest | macOS Docker 运行时 |
| Docker Compose | v5.1.3 | Tyk 容器编排 |
| Tyk Gateway | v5.12.1 | API 网关 |
| Redis | 7.4-alpine | Tyk 运行时存储 |
| Node.js | ≥18 | 前端开发 |
| Supabase | 在线服务 | 用户认证 |

---

## 八、版本变更记录

| 日期 | Commit | 变更摘要 |
|------|--------|---------|
| 2026-05-16 | `dc62b6b` | 阿里规约接入 + 全文件 JSDoc 注释 + 关键 Bug 修复 |
| 2026-05-15 | `e788aac` | v1 第一轮开发总结 |
| 2026-05-15 | 多 commits | Stage 0-4 页面开发 |
| 2026-05-14 | `7ac9dfa` | 设计文档 + 实施计划初稿 |

---

> **规则**：每次修改问题前先读此文件；每次 git 新版本后更新此文件的版本号、变更模块、新增/删除的文件。
