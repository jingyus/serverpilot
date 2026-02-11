# PM2 常用配置模板

## 配置

以下为 PM2 常用配置模板和进程管理方案。

### ecosystem.config.js 配置

### 基础配置

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "my-app",
      script: "./dist/index.js",
      instances: "max",            // Cluster 模式，使用所有 CPU
      exec_mode: "cluster",

      // 环境变量
      env: {
        NODE_ENV: "development",
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
};
```

### 完整生产配置

```javascript
// ecosystem.config.js - 生产环境
module.exports = {
  apps: [
    {
      name: "api-server",
      script: "./dist/server.js",
      instances: "max",
      exec_mode: "cluster",

      // 环境变量
      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
      },

      // 内存限制（超过自动重启）
      max_memory_restart: "1G",

      // 日志配置
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "/var/log/pm2/api-error.log",
      out_file: "/var/log/pm2/api-out.log",
      merge_logs: true,
      log_type: "json",

      // 重启策略
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 4000,

      // 监听文件变化（开发环境）
      // watch: true,
      // watch_delay: 1000,
      // ignore_watch: ["node_modules", "logs", ".git"],

      // 零停机重载
      listen_timeout: 8000,
      kill_timeout: 5000,
      wait_ready: true,

      // 自动重启
      autorestart: true,
      cron_restart: "0 3 * * *",  // 每天凌晨 3 点重启
    },
  ],
};
```

### 多应用配置

```javascript
// ecosystem.config.js - 多应用
module.exports = {
  apps: [
    {
      name: "api",
      script: "./dist/api.js",
      instances: 4,
      exec_mode: "cluster",
      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
    {
      name: "worker",
      script: "./dist/worker.js",
      instances: 2,
      exec_mode: "fork",
      env_production: {
        NODE_ENV: "production",
      },
    },
    {
      name: "scheduler",
      script: "./dist/scheduler.js",
      instances: 1,
      exec_mode: "fork",
      cron_restart: "0 0 * * *",
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};

// 启动所有应用
// pm2 start ecosystem.config.js --env production
```

## 非 Node.js 应用配置

### Python 应用

```javascript
module.exports = {
  apps: [
    {
      name: "python-app",
      script: "app.py",
      interpreter: "python3",
      // 或指定虚拟环境
      // interpreter: "/opt/myapp/.venv/bin/python",
      env: {
        FLASK_ENV: "production",
      },
    },
  ],
};
```

### Shell 脚本

```javascript
module.exports = {
  apps: [
    {
      name: "backup-job",
      script: "./scripts/backup.sh",
      interpreter: "/bin/bash",
      cron_restart: "0 2 * * *",
      autorestart: false,
    },
  ],
};
```

## 日志管理

### pm2-logrotate 模块

```bash
# 安装日志轮转模块
pm2 install pm2-logrotate

# 配置参数
pm2 set pm2-logrotate:max_size 10M       # 单文件最大 10MB
pm2 set pm2-logrotate:retain 30          # 保留 30 个文件
pm2 set pm2-logrotate:compress true      # 压缩旧日志
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
pm2 set pm2-logrotate:rotateModule true  # 轮转模块日志
pm2 set pm2-logrotate:workerInterval 30  # 检查间隔（秒）
pm2 set pm2-logrotate:rotateInterval "0 0 * * *"  # 每天轮转
```

### 日志管理命令

```bash
# 查看日志
pm2 logs                        # 所有应用
pm2 logs api --lines 200        # 最近 200 行

# 清空日志
pm2 flush                       # 清空所有日志
pm2 flush api                   # 清空指定应用

# 日志输出到文件（自定义）
pm2 start app.js \
  --log /var/log/pm2/combined.log \
  --output /var/log/pm2/out.log \
  --error /var/log/pm2/error.log
```

## Cluster 模式配置

```bash
# 按 CPU 核心数启动
pm2 start app.js -i max

# 指定实例数
pm2 start app.js -i 4

# 零停机重载（逐一重启 worker）
pm2 reload app

# 动态扩缩容
pm2 scale app +2    # 增加 2 个实例
pm2 scale app 8     # 设置为 8 个实例
```

### Graceful Shutdown

```javascript
// app.js - 优雅关闭
const server = app.listen(port, () => {
  // 通知 PM2 应用已准备就绪
  process.send('ready');
});

process.on('SIGINT', () => {
  console.log('Graceful shutdown...');
  server.close(() => {
    // 关闭数据库连接等
    process.exit(0);
  });
  // 强制超时
  setTimeout(() => process.exit(1), 5000);
});
```

## 部署配置

```javascript
// ecosystem.config.js - 部署
module.exports = {
  apps: [{ /* ... */ }],

  deploy: {
    production: {
      user: "deploy",
      host: ["10.0.0.1", "10.0.0.2"],
      ref: "origin/main",
      repo: "git@github.com:user/repo.git",
      path: "/opt/myapp",
      "pre-deploy-local": "",
      "post-deploy": "pnpm install && pnpm build && pm2 reload ecosystem.config.js --env production",
      "pre-setup": "",
    },
  },
};
```

```bash
# 初始化远程目录
pm2 deploy ecosystem.config.js production setup

# 部署
pm2 deploy ecosystem.config.js production

# 回滚
pm2 deploy ecosystem.config.js production revert 1
```

## 监控配置

```bash
# 内置监控面板
pm2 monit

# PM2 Plus（Web 监控面板）
pm2 link <secret_key> <public_key>

# 查看进程详情
pm2 describe api

# 查看指标
pm2 prettylist
```
