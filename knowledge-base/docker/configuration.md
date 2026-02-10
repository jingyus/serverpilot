# Docker 常用配置与 Compose 模板

## Dockerfile 最佳实践

### Node.js 应用 Dockerfile

```dockerfile
# 使用多阶段构建
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER appuser
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Python 应用 Dockerfile

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN adduser --disabled-password --gecos '' appuser
USER appuser
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## Docker Compose 配置

### Web 应用 + 数据库 + Redis

```yaml
# docker-compose.yml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/myapp
      - REDIS_URL=redis://redis:6379
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    restart: unless-stopped
    networks:
      - app-network

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user -d myapp"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - app-network

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass redis_pass
    volumes:
      - redis_data:/data
    networks:
      - app-network

volumes:
  postgres_data:
  redis_data:

networks:
  app-network:
    driver: bridge
```

### Nginx 反向代理 + SSL

```yaml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./certs:/etc/nginx/ssl:ro
    depends_on:
      - app
    restart: unless-stopped

  app:
    build: .
    expose:
      - "3000"
    restart: unless-stopped
```

## 常用 Docker 命令

### 容器管理

```bash
# 查看运行中的容器
docker ps

# 查看所有容器（含停止的）
docker ps -a

# 启动/停止/重启容器
docker start <container>
docker stop <container>
docker restart <container>

# 进入容器
docker exec -it <container> sh

# 查看容器日志
docker logs -f --tail 100 <container>

# 查看容器资源使用
docker stats

# 删除所有停止的容器
docker container prune
```

### 镜像管理

```bash
# 查看本地镜像
docker images

# 构建镜像
docker build -t myapp:latest .

# 删除镜像
docker rmi <image>

# 清理未使用的镜像
docker image prune -a

# 导出/导入镜像
docker save myapp:latest > myapp.tar
docker load < myapp.tar
```

### 卷管理

```bash
# 查看所有卷
docker volume ls

# 创建卷
docker volume create mydata

# 查看卷详情
docker volume inspect mydata

# 删除未使用的卷
docker volume prune
```

### 网络管理

```bash
# 查看网络
docker network ls

# 创建网络
docker network create --driver bridge my-network

# 将容器连接到网络
docker network connect my-network <container>

# 查看网络详情
docker network inspect my-network
```

## Docker Compose 命令

```bash
# 启动所有服务
docker compose up -d

# 停止所有服务
docker compose down

# 停止并删除卷
docker compose down -v

# 查看服务日志
docker compose logs -f

# 重新构建并启动
docker compose up -d --build

# 扩容服务
docker compose up -d --scale app=3

# 查看服务状态
docker compose ps

# 执行命令
docker compose exec app sh
```

## 资源限制配置

```yaml
services:
  app:
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 256M
    # 或使用传统语法
    # mem_limit: 1g
    # cpus: 2.0
```

## 健康检查配置

```yaml
services:
  app:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```
