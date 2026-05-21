# 部署信息 — ichse-asset-share-center

> 最后更新：2026-05-21 | Commit: `cfa8023`
> 保持此文件与当前运行环境同步。每次环境变更后更新。

---

## 一、基础设施

### 1.1 容器运行时

| 项 | 值 |
|----|-----|
| 方案 | Colima（替代 Docker Desktop） |
| 版本 | colima 0.10.1 |
| VM 类型 | `vz`（macOS Virtualization Framework） |
| 文件系统挂载 | `virtiofs` |
| CPU / 内存 / 磁盘 | 4 cores / 4 GB / 100 GB |
| Docker CLI | 29.4.1 |
| Docker Compose | 5.1.3 (standalone, 非 plugin) |

### 1.2 网络代理

| 项 | 值 |
|----|-----|
| 代理类型 | HTTP（Clash/V2Ray） |
| 代理地址 | `127.0.0.1:10807` |
| 用途 | Docker 拉镜像（`HTTP_PROXY=... docker pull`） |
| 注意 | Colima VM 内 Docker daemon 不自动走宿主代理，需手动传环境变量 |

---

## 二、Docker 容器

### 2.1 容器全景

```
┌─────────────────────────────────────────────────────┐
│                    macOS Host                        │
│  ┌──────────────────────────────────────────────┐   │
│  │              Colima VM (vz)                    │   │
│  │                                                │   │
│  │  ┌─────────────────┐  ┌──────────────────┐    │   │
│  │  │   Tyk Network    │  │  Project Network  │    │   │
│  │  │                 │  │                   │    │   │
│  │  │  tyk-gateway ◄─┼──┼─► tyk-redis       │    │   │
│  │  │  :8080          │  │  :6379            │    │   │
│  │  └────────┬────────┘  └──────────────────┘    │   │
│  │           │                                     │   │
│  │  ┌────────┴────────────────────────────────┐   │   │
│  │  │        Project Network                   │   │   │
│  │  │                                          │   │   │
│  │  │  ichse-postgres ◄── ichse-postgrest     │   │   │
│  │  │  :5433              :3001                │   │   │
│  │  └──────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  Vite Dev Server :5173 ──► proxy ──► Tyk :8080          │
│                           ──► proxy ──► PostgREST :3001  │
└─────────────────────────────────────────────────────┘
```

### 2.2 容器清单

| 容器名 | 镜像 | 端口 | 网络 | 数据卷 |
|--------|------|:----:|------|--------|
| `tyk-gateway-docker-tyk-gateway-1` | `tykio/tyk-gateway:v5.12.1` | 8080 | `tyk-gateway-docker_tyk` | `./config:/opt/tyk-gateway/config` |
| `tyk-gateway-docker-tyk-redis-1` | `redis:7.4-alpine` | 6379 | `tyk-gateway-docker_tyk` | — |
| `ichse-postgres` | `postgres:17-alpine` | 5433 | `ichse-asset-share-center_default` | `./pgdata:/var/lib/postgresql/data` |
| `ichse-postgrest` | `postgrest/postgrest:latest` | 3001 | `ichse-asset-share-center_default` | — |

### 2.3 PostgreSQL 连接信息

| 项 | 值 |
|----|-----|
| Host | `localhost:5433` |
| 容器内 | `ichse-postgres:5432` |
| 用户 | `ichse` |
| 密码 | `ichse_dev` |
| 数据库 | `ichse` |
| Schema | `ichse` |
| PostgREST URI | `postgres://ichse:ichse_dev@postgres:5432/ichse` |

### 2.4 Tyk Gateway 连接信息

| 项 | 值 |
|----|-----|
| API 端点 | `http://localhost:8080` |
| Secret | `foo`（开发环境，非敏感） |
| 健康检查 | `GET /hello` |
| Redis | `tyk-redis:6379` |

---

## 三、启动流程

### 3.1 完整启动（冷启动）

```bash
# 1. 启动 Colima VM
colima start

# 2. 拉取镜像（首次/更新时，需代理）
HTTP_PROXY=http://127.0.0.1:10807 HTTPS_PROXY=http://127.0.0.1:10807 \
  docker-compose -f ~/Hermes/git-tyk/tyk-gateway-docker/docker-compose.yml pull

# 3. 启动 Tyk Gateway + Redis
docker-compose -f ~/Hermes/git-tyk/tyk-gateway-docker/docker-compose.yml up -d

# 4. 启动 PostgreSQL + PostgREST
docker-compose -f /Users/phoenix/Hermes/refine-projects/ichse-asset-share-center/docker-compose.yml up -d

# 5. 首次建表
cat database/postgresql/schema.sql | docker exec -i ichse-postgres psql -U ichse -d ichse

# 6. 启动 Vite
cd /Users/phoenix/Hermes/refine-projects/ichse-asset-share-center
npx vite --host 0.0.0.0
```

### 3.2 日常启动（容器已存在）

```bash
colima start
docker start tyk-gateway-docker-tyk-redis-1 tyk-gateway-docker-tyk-gateway-1
docker start ichse-postgres ichse-postgrest
cd /Users/phoenix/Hermes/refine-projects/ichse-asset-share-center && npx vite --host 0.0.0.0
```

### 3.3 停止

```bash
# 停止容器（保留数据）
docker stop tyk-gateway-docker-tyk-gateway-1 tyk-gateway-docker-tyk-redis-1
docker stop ichse-postgrest ichse-postgres

# 停止 Colima VM（释放资源）
colima stop
```

---

## 四、端口清单

| 端口 | 服务 | 协议 | 外部 | 用途 |
|:----:|------|------|:----:|------|
| 5173 | Vite Dev Server | HTTP | ✅ | 前端开发 |
| 8080 | Tyk Gateway API | HTTP | ✅ | API/密钥管理 |
| 6379 | Redis | TCP | ✅ | Tyk 存储后端 |
| 5433 | PostgreSQL | TCP | ✅ | 管理数据库 |
| 3001 | PostgREST | HTTP | ✅ | PostgreSQL REST API |

---

## 五、Vite 代理规则

`vite.config.ts` 中配置：

| 前缀 | 目标 | 用途 |
|------|------|------|
| `/tyk/*` | `http://localhost:8080` | Tyk Gateway API |
| `/hello` | `http://localhost:8080` | Tyk 健康检查 |
| `/db/*` | `http://localhost:3001` | PostgREST（`/db` 前缀被 rewrite 移除） |

---

## 六、已知问题与配置偏离

### 6.1 Tyk docker-compose 修改（2026-05-21）

原文件：`~/Hermes/git-tyk/tyk-gateway-docker/docker-compose.yml`

| 改动 | 原因 |
|------|------|
| 单文件挂载 `./tyk.standalone.conf` → 目录挂载 `./config` | Colima `virtiofs` 不支持单文件 bind mount |
| 新增 `command: --conf=/opt/tyk-gateway/config/tyk.conf` | 配置文件路径从默认位置变更 |
| 新增 `user: root` | 容器 UID 65532 无权读取 host 文件（virtiofs UID 映射问题） |
| 新增 `./config/tyk.conf` | 配置文件副本，原名 `tyk.standalone.conf` |

### 6.2 Docker 拉镜像需代理

```bash
# 每次都需手动传 HTTP_PROXY
HTTP_PROXY=http://127.0.0.1:10807 HTTPS_PROXY=http://127.0.0.1:10807 docker pull <image>
```

### 6.3 `docker compose` vs `docker-compose`

本机安装的是 standalone `docker-compose` v5.1.3，不是 Docker plugin。使用 `docker-compose` 命令（带连字符），不能用 `docker compose`。

---

## 七、验证检查清单

```bash
# Colima
colima status                              # 应显示 "colima is running"

# Docker
docker ps                                  # 应显示 4 个容器 running

# Tyk
curl -s http://localhost:8080/hello        # {"status":"pass"...}

# PostgREST
curl -s http://localhost:3001/             # 应有响应

# PostgreSQL
docker exec ichse-postgres pg_isready -U ichse  # accepting connections

# Vite
curl -s -o /dev/null -w '%{http_code}' http://localhost:5173/  # 200
```

---

## 八、文件路径速查

| 用途 | 路径 |
|------|------|
| 项目根目录 | `/Users/phoenix/Hermes/refine-projects/ichse-asset-share-center` |
| Tyk docker-compose | `/Users/phoenix/Hermes/git-tyk/tyk-gateway-docker/docker-compose.yml` |
| Tyk 配置文件 | `/Users/phoenix/Hermes/git-tyk/tyk-gateway-docker/config/tyk.conf` |
| 项目 docker-compose | `docker-compose.yml`（项目根） |
| 数据库 Schema | `database/postgresql/schema.sql` |
| pgdata（持久化） | `./pgdata/`（项目根） |
| 设计文档 | `design/` |
| 开发日志 | `dev-logs/` |
| 架构决策 | `docs/adr/` |
