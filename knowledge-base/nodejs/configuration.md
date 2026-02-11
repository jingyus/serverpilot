# Node.js 常用配置与运行优化

## 配置

以下为 Node.js 项目常用配置和运行优化方案。

### package.json 配置

### 基础 package.json 模板

```json
{
  "name": "my-app",
  "version": "1.0.0",
  "type": "module",
  "engines": {
    "node": ">=22.0.0"
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  }
}
```

### TypeScript 配置

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

## 环境变量配置

### .env 文件管理

```bash
# .env（不提交到 Git）
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://user:pass@localhost:5432/myapp
REDIS_URL=redis://localhost:6379
API_KEY=your-secret-key
```

```typescript
// 使用 Node.js 22 原生 .env 支持
// node --env-file=.env dist/index.js

// 或在代码中读取
const port = process.env.PORT || 3000;
```

## 内存配置

```bash
# 设置最大堆内存（默认约 1.7GB）
node --max-old-space-size=4096 dist/index.js

# 查看当前内存使用
node -e "console.log(process.memoryUsage())"

# PM2 配置内存限制
pm2 start dist/index.js --max-memory-restart 1G
```

## 日志配置（Pino）

```typescript
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty' }
    : undefined,
  // 生产环境 JSON 格式
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export { logger };
```

## 错误处理

### 全局未捕获错误处理

```typescript
// 未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// 未处理的 Promise 拒绝
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

// 优雅关闭
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await server.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await server.close();
  process.exit(0);
});
```

## npm/pnpm 配置

### .npmrc 配置

```ini
# .npmrc
engine-strict=true
save-exact=true
auto-install-peers=true

# 私有仓库
# registry=https://npm.example.com/
# //npm.example.com/:_authToken=${NPM_TOKEN}

# 设置国内镜像
# registry=https://registry.npmmirror.com
```

### pnpm workspace 配置

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
```

## 健康检查端点

```typescript
// 基本健康检查
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    version: process.version,
  });
});

// 深度健康检查（含依赖）
app.get('/health/ready', async (c) => {
  const checks = {
    database: false,
    redis: false,
  };

  try {
    await db.execute(sql`SELECT 1`);
    checks.database = true;
  } catch { /* ignore */ }

  try {
    await redis.ping();
    checks.redis = true;
  } catch { /* ignore */ }

  const allHealthy = Object.values(checks).every(Boolean);
  return c.json({ status: allHealthy ? 'ok' : 'degraded', checks }, allHealthy ? 200 : 503);
});
```

## 安全配置

### Helmet 中间件（Express/Hono）

```typescript
// 设置安全 HTTP 头
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '0');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header('Content-Security-Policy', "default-src 'self'");
});
```

### CORS 配置

```typescript
import { cors } from 'hono/cors';

app.use('/api/*', cors({
  origin: ['https://example.com'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));
```
