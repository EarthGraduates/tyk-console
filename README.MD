# ichse Asset Share Center

Tyk Gateway OSS 管理界面 — 医疗行业 API 网关资产共享中心

| 版本 | 品牌色 | 框架 |
|------|--------|------|
| V1.1 | 极光绿 `#52c41a` | Refine v5 + Ant Design v5.23 + React 19 |

---

## 功能模块

| 模块 | 功能 |
|------|------|
| 仪表板 | 网关状态 / API 运行状态（分页+搜索+排序） / 一键重载 |
| 服务管理 | API 完整 CRUD / Drawer 详情 / 克隆 / 搜索+分页 |
| 密钥管理 | 创建/编辑/删除 / 速率+配额+过期配置 / 搜索+分页 |
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

## License

MIT
