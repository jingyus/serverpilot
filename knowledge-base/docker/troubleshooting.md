# Docker 故障排查与安全加固

## 常见故障排查

### 1. 容器无法启动

**症状**: `docker start` 后容器立即退出

```bash
# 查看容器日志
docker logs <container>

# 查看容器详细信息
docker inspect <container>

# 交互模式运行调试
docker run -it <image> sh

# 常见原因：
# - 入口命令执行失败
# - 缺少环境变量
# - 端口冲突
# - 依赖服务未就绪
```

### 2. 镜像构建失败

```bash
# 使用 --no-cache 重新构建
docker build --no-cache -t myapp .

# 使用 --progress=plain 查看详细输出
docker build --progress=plain -t myapp .

# 常见原因：
# - 基础镜像不存在
# - 包管理器找不到包（apt/apk/pip）
# - COPY 的文件不在构建上下文中
# - 多阶段构建引用不存在的阶段
```

### 3. 磁盘空间不足

```bash
# 查看 Docker 磁盘使用
docker system df

# 清理所有未使用的资源
docker system prune -a --volumes

# 分步清理
docker container prune  # 清理停止的容器
docker image prune -a   # 清理未使用的镜像
docker volume prune     # 清理未使用的卷
docker network prune    # 清理未使用的网络

# 限制日志大小（daemon.json）
# "log-opts": { "max-size": "10m", "max-file": "3" }
```

### 4. 容器网络问题

```bash
# 检查容器网络
docker inspect --format='{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' <container>

# 测试容器间连通性
docker exec <container1> ping <container2>

# 查看网络配置
docker network inspect bridge

# DNS 解析问题
docker exec <container> nslookup google.com

# 常见原因：
# - 容器不在同一网络
# - DNS 配置错误
# - 防火墙规则阻断
# - Docker 网络子网冲突
```

### 5. 容器内存不足（OOM）

```bash
# 查看容器内存使用
docker stats <container>

# 查看 OOM 事件
docker inspect <container> | grep -i oom
dmesg | grep -i oom

# 增加内存限制
docker run -m 2g <image>
```

### 6. 端口映射问题

```bash
# 检查端口映射
docker port <container>

# 检查宿主机端口占用
sudo ss -tlnp | grep <port>

# 确认容器内服务绑定 0.0.0.0 而非 127.0.0.1
docker exec <container> ss -tlnp
```

### 7. 卷挂载权限问题

```bash
# 检查卷挂载
docker inspect <container> --format='{{json .Mounts}}'

# 修复权限（在 Dockerfile 中）
# RUN chown -R appuser:appgroup /data

# 使用命名卷代替绑定挂载
docker run -v mydata:/data <image>

# Linux 上设置用户映射
# 在 docker run 中使用 --user $(id -u):$(id -g)
```

## 性能优化

### 镜像优化

```dockerfile
# 使用 alpine 基础镜像减小体积
FROM node:22-alpine

# 合并 RUN 命令减少层数
RUN apk add --no-cache curl && \
    rm -rf /var/cache/apk/*

# 使用 .dockerignore 排除不需要的文件
```

`.dockerignore` 示例：
```
node_modules
.git
.env
*.md
docker-compose*.yml
Dockerfile
```

### 构建缓存优化

```dockerfile
# 先复制依赖文件，利用缓存
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# 再复制源代码
COPY . .
RUN pnpm build
```

## 安全加固

### 容器运行安全

```bash
# 使用非 root 用户运行
docker run --user 1000:1000 <image>

# 只读文件系统
docker run --read-only --tmpfs /tmp <image>

# 限制内核能力
docker run --cap-drop ALL --cap-add NET_BIND_SERVICE <image>

# 禁止提权
docker run --security-opt no-new-privileges <image>

# 限制资源
docker run --memory=512m --cpus=1.0 --pids-limit=100 <image>
```

### Docker Daemon 安全

```json
{
  "icc": false,
  "userns-remap": "default",
  "no-new-privileges": true,
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

### 镜像安全

```bash
# 扫描镜像漏洞
docker scout cves <image>

# 使用特定版本标签而非 latest
# 好: FROM node:22.5-alpine
# 差: FROM node:latest

# 验证镜像签名
docker trust inspect <image>
```

### 网络安全

```bash
# 使用自定义网络隔离
docker network create --internal internal-network

# 限制容器间通信
# 在 daemon.json 中设置 "icc": false
```

## 日志管理

```bash
# 查看容器日志
docker logs --tail 100 -f <container>

# 查看日志文件位置
docker inspect --format='{{.LogPath}}' <container>

# 配置日志驱动（daemon.json）
# json-file: 默认，写入 JSON 文件
# syslog: 发送到 syslog
# journald: 发送到 systemd journal
# fluentd: 发送到 Fluentd
```
