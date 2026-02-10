# Node.js 故障排查与最佳实践

## 常见故障排查

### 1. 内存泄漏

**症状**: 应用内存持续增长，最终 OOM 崩溃

```bash
# 监控内存使用
node --max-old-space-size=2048 dist/index.js

# 生成堆快照
node --inspect dist/index.js
# 然后在 Chrome DevTools 中连接 chrome://inspect

# 代码中手动触发 GC（调试用）
node --expose-gc dist/index.js
```

```typescript
// 监控内存使用
setInterval(() => {
  const used = process.memoryUsage();
  console.log({
    rss: `${Math.round(used.rss / 1024 / 1024)} MB`,
    heapTotal: `${Math.round(used.heapTotal / 1024 / 1024)} MB`,
    heapUsed: `${Math.round(used.heapUsed / 1024 / 1024)} MB`,
    external: `${Math.round(used.external / 1024 / 1024)} MB`,
  });
}, 30000);
```

**常见原因**:
- 全局变量持续累积数据
- 事件监听器未移除
- 闭包引用大对象
- 缓存无限增长

### 2. Event Loop 阻塞

**症状**: 响应延迟急剧增加

```typescript
// 检测事件循环延迟
import { monitorEventLoopDelay } from 'node:perf_hooks';

const h = monitorEventLoopDelay({ resolution: 20 });
h.enable();

setInterval(() => {
  console.log({
    min: h.min / 1e6,
    max: h.max / 1e6,
    mean: h.mean / 1e6,
    p99: h.percentile(99) / 1e6,
  });
  h.reset();
}, 5000);
```

**解决方案**:
- 将 CPU 密集型任务移至 Worker Threads
- 使用 `setImmediate()` 分片处理大数据
- 避免同步 I/O 操作（`readFileSync` 等）

### 3. ECONNREFUSED / ECONNRESET

**症状**: 无法连接上游服务

```bash
# 检查目标服务是否运行
curl -v http://localhost:3000

# 检查端口监听
sudo ss -tlnp | grep <port>

# 检查 DNS 解析
node -e "require('dns').lookup('hostname', console.log)"
```

**解决方案**:
- 检查目标服务是否启动
- 检查防火墙规则
- 增加连接超时和重试逻辑
- 检查连接池是否耗尽

### 4. EMFILE: Too many open files

```bash
# 查看当前限制
ulimit -n

# 临时增加
ulimit -n 65535

# 永久修改 /etc/security/limits.conf
# * soft nofile 65535
# * hard nofile 65535
```

### 5. npm/pnpm 安装失败

```bash
# 清除缓存
npm cache clean --force
pnpm store prune

# 删除 node_modules 重新安装
rm -rf node_modules
pnpm install

# 网络问题：使用镜像
npm config set registry https://registry.npmmirror.com

# 权限问题
sudo chown -R $(whoami) ~/.npm
```

### 6. TypeScript 编译错误

```bash
# 查看详细错误
npx tsc --noEmit --pretty

# 常见问题：
# - 缺少类型声明：npm install -D @types/<package>
# - 模块解析失败：检查 tsconfig.json moduleResolution
# - 路径别名未生效：检查 tsconfig paths 和构建工具配置
```

### 7. 端口被占用

```bash
# 查找占用端口的进程
sudo lsof -i :3000

# 终止进程
kill -9 <PID>

# 或使用 fuser
sudo fuser -k 3000/tcp
```

## 性能优化

### 集群模式

```typescript
import cluster from 'node:cluster';
import os from 'node:os';

if (cluster.isPrimary) {
  const numCPUs = os.cpus().length;
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  cluster.on('exit', (worker) => {
    console.log(`Worker ${worker.process.pid} died, restarting...`);
    cluster.fork();
  });
} else {
  // 启动应用服务器
  startServer();
}
```

### 数据库连接池

```typescript
// 使用连接池避免频繁创建连接
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,           // 最大连接数
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
```

### 响应压缩

```typescript
import { compress } from 'hono/compress';

app.use('*', compress());
```

## 安全最佳实践

### 依赖安全

```bash
# 检查依赖漏洞
npm audit
pnpm audit

# 自动修复
npm audit fix

# 使用 Snyk 深度扫描
npx snyk test
```

### 输入验证

```typescript
import { z } from 'zod';

// 使用 Zod 验证请求体
const CreateUserSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(100),
  password: z.string().min(8).max(128),
});

app.post('/users', async (c) => {
  const body = await c.req.json();
  const result = CreateUserSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: result.error.flatten() }, 400);
  }
  // 使用 result.data（已验证和类型安全）
});
```

### 速率限制

```typescript
// 简单的内存速率限制
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (record.count >= limit) {
    return false;
  }

  record.count++;
  return true;
}
```

## 调试技巧

```bash
# 启用调试模式
NODE_DEBUG=http,net node dist/index.js

# 使用 Inspector
node --inspect dist/index.js
# 然后打开 Chrome DevTools: chrome://inspect

# 使用 --inspect-brk 在第一行断点
node --inspect-brk dist/index.js

# 查看模块加载
NODE_DEBUG=module node dist/index.js
```
