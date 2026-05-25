# ichse Asset Share Center

Tyk Gateway OSS 管理界面 — 医疗行业 API 网关资产共享中心

| 版本 | 品牌色 | 框架 |
|------|--------|------|
| V1.3 | 极光绿 `#52c41a` | Refine v6 + Ant Design v6.4 + React 19 |

---

## 技术栈

| 组件 | 版本 | 用途 |
|------|------|------|
| Refine (antd) | v6.0 | 前端框架（Data Provider + Auth Provider） |
| Refine (core) | v5.0 | 核心状态管理 |
| Ant Design | v6.4 | UI 组件库 |
| React | v19.1 | 前端运行时 |
| TypeScript | v5.8 | 类型系统 |
| Vite | v6.3 | 构建工具 |
| Tyk Gateway OSS | v5.12 | API 网关（被管理对象） |
| PostgreSQL | v17.10 | 管理数据库 |
| PostgREST | v14.11 | DB → REST API 桥接 |
| Docker (Colima) | — | 容器运行时 |

---

## 功能模块

| 模块 | 功能 |
|------|------|
| 仪表板 | 网关状态 / API 运行状态（分页+搜索+排序） / 一键重载 |
| 服务管理 | API 完整 CRUD / Drawer 详情 / 克隆 / 搜索+分页 |
| 密钥管理 | 创建/编辑/删除 / 速率+配额+过期配置 / 搜索+分页 |
| 认证 & 用户 | JWT 登录 / 角色菜单 / 路由守卫 / 用户管理（CRUD） |
| 审计日志 | 操作审计 / 时间范围查询 / 按用户/模块筛选 |
| 安全策略 | 密码策略配置 / 会话超时配置 / 持久化存储 |
| 历史记录 | API 记录归档 / DB 优先架构 / 删除/停用/启用/同步 |
| 网关管理 | 容器状态监控 / 启停/重启控制 |
| 设置 | Tyk Gateway 连接参数 / Docker 管理服务地址 |

---

## 架构

```
浏览器 (localhost:5173)
  ├── /tyk/* → Tyk Gateway (localhost:8080)       ← API/密钥 CRUD
  ├── /hello → Tyk Gateway                         ← 健康检查
  └── /db/*  → PostgREST (localhost:3001)          ← 管理数据库
                   └── PostgreSQL (localhost:5433)
```

---

## 环境启动

```bash
# 1. 启动 Docker
colima start

# 2. Tyk Gateway（需 enable_health_checks: true）
docker-compose -f ~/Hermes/git-tyk/tyk-gateway-docker/docker-compose.yml up -d

# 3. 管理数据库
docker-compose -f docker-compose.yml up -d

# 4. 首次建表
cat database/postgresql/schema.sql | docker exec -i ichse-postgres psql -U ichse -d ichse

# 5. 启动前端
npm run dev                    # → http://localhost:5173
```

---

## 代码审查

```bash
npx eslint src/                # 阿里前端规约
npx eslint src/ --fix
```

---

## 项目文档

| 文件 | 内容 |
|------|------|
| `design/database-design.md` | 数据库设计 v1.4 |
| `design/antd-spec-summary.md` | antd 设计规范分析 |
| `design/antd-color-palette.md` | 官方色板参考 |
| `dev-logs/v1.1-index.md` | 项目索引 + 变更记录 |
| `dev-logs/2026-05-20-summary.md` | 每日开发总结 |

---

## 更新日志

### V1.3 — Phase 3 安全配置与迁移 (2026-05-25)

- **安全配置持久化**: 密码策略、会话超时配置写入 DB，支持 CRUD
- **会话管理**: 基于配置的会话超时自动踢出
- **antd v6 迁移**: `destroyOnClose`→`destroyOnHidden`, `valueStyle`→`styles.content`, `Drawer width`→`size`
- **审计日志修复**: 时间范围查询改用 PostgREST `and` 逻辑组语法

### V1.2 — Phase 2 RBAC (2026-05-23)

- **JWT 认证系统**: 从 Supabase 迁移到 pgjwt + PostgREST RLS，自建完整鉴权链路
- **角色菜单**: 基于用户 role 动态渲染侧边栏
- **路由守卫**: 无权限页面前端拦截 + 后端 RLS 兜底
- **用户管理**: 完整 CRUD，含角色分配、JWT 生成
- **审计日志**: 操作审计记录，时间范围查询
- **部署文档**: 生产环境部署指南

### V1.1 — 数据持久化 + 规范完善 (2026-05-16 ~ 2026-05-20)

- **PostgreSQL + PostgREST**: 本地 PG 替代 Supabase，4 张表（users/api_definitions/api_definition_log/api_keys）
- **历史 API 记录**: API 归档页，DB 优先架构，删除/停用/启用/同步联动
- **极光绿品牌色**: 全面替换 `#52c41a`，浅色一体主题
- **antd 设计规范**: 表格搜索+分页+校验+placeholder 全面补全
- **API Drawer 详情**: 替代独立路由跳转，暗色代码主题 JSON 展示
- **dashboard**: 懒加载健康状态、分页、搜索、排序
- **阿里 ESLint 规约**: `eslint-config-ali` 接入，全量 JSDoc 注释
- **密钥增强**: 授权 API 列、`enable_hashed_keys_listing` 适配、404 降级

### V1.0 — 核心 CRUD (2026-05-13 ~ 2026-05-15)

- 仪表板：网关状态、API 健康、一键重载
- 服务管理：API 完整 CRUD、Modal 创建/编辑、搜索分页
- 密钥管理：创建/编辑/删除、速率+配额+过期配置
- Vite Proxy：开发环境 CORS 解决方案
- Data Provider：Tyk API 适配、内置默认 Secret
- 双模型设计评审：独立评审 + 汇总报告，P0/P1 问题修复
- 架构决策：前端直调 Tyk API（取消后端代理）、Docker 管理 dockerode thin service

---

## License

MIT
