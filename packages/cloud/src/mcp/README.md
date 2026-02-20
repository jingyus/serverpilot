# MCP (Model Context Protocol) 集成

## 概述

ServerPilot Cloud 集成了 MCP (Model Context Protocol),可以连接到各种 MCP Server 来增强 AI 对话能力。

当前支持的 MCP Servers:
- ✅ **Context7**: 文档搜索（官方文档、StackOverflow、GitHub）
- 🚧 **GitHub MCP**: 代码仓库、Issue、PR（待实现）
- 🚧 **Jira MCP**: 工单管理（待实现）

## 快速开始

### 1. 获取 Context7 API Key

访问 [Context7 官网](https://context7.com) 注册并获取 API Key。

### 2. 配置环境变量

```bash
# .env.cloud
CONTEXT7_API_KEY=your_api_key_here
```

### 3. 初始化 Knowledge Enhancer

```typescript
import { KnowledgeEnhancer } from '@aiinstaller/cloud/ai/knowledge-enhancer';

const enhancer = new KnowledgeEnhancer({
  enabled: true,
  apiKey: process.env.CONTEXT7_API_KEY,
  defaultSources: ['nginx', 'docker', 'kubernetes'],
  maxResults: 3,
});

await enhancer.initialize();
```

### 4. 在 AI 对话前搜索相关文档

```typescript
// 在处理用户消息前
const userMessage = "How to configure nginx reverse proxy for WebSocket?";
const modelContextWindow = 200000; // Claude 3.5 Sonnet

const knowledgeContext = await enhancer.searchRelevantDocs(
  userMessage,
  modelContextWindow
);

if (knowledgeContext) {
  // 将知识注入到 system prompt
  const systemPrompt = `${BASE_SYSTEM_PROMPT}

${knowledgeContext}

请根据以上文档信息回答用户问题。`;

  // 调用 AI Provider
  const response = await provider.chat({
    messages: [{ role: 'user', content: userMessage }],
    system: systemPrompt,
  });
}
```

## API 文档

### MCPClientManager

#### `connectContext7(apiKey: string): Promise<void>`

连接到 Context7 MCP Server。

```typescript
import { getMCPClientManager } from '@aiinstaller/cloud/mcp/client-manager';

const manager = getMCPClientManager();
await manager.connectContext7('your_api_key');
```

#### `searchDocs(params: SearchDocsParams): Promise<string[]>`

搜索文档。

```typescript
const results = await manager.searchDocs({
  query: 'nginx reverse proxy websocket',
  sources: ['nginx', 'docker'],
  maxResults: 5,
});

console.log(results);
// [
//   "Nginx reverse proxy configuration for WebSocket...",
//   "Docker Compose setup with Nginx...",
//   ...
// ]
```

参数:
- `query`: 搜索查询
- `sources`: 可选,限定搜索源（如 `['nginx', 'docker']`）
- `maxResults`: 可选,最大结果数（默认 5）

#### `fetchDocument(url: string): Promise<string>`

获取指定 URL 的文档内容。

```typescript
const content = await manager.fetchDocument('https://nginx.org/en/docs/http/websocket.html');
```

#### `disconnect(serverName: string): Promise<void>`

断开指定 MCP Server 连接。

```typescript
await manager.disconnect('context7');
```

### KnowledgeEnhancer

#### `initialize(): Promise<void>`

初始化并连接到 Context7。

```typescript
const enhancer = new KnowledgeEnhancer({
  enabled: true,
  apiKey: 'your_api_key',
});

await enhancer.initialize();
```

#### `searchRelevantDocs(userMessage: string, modelContextWindow: number): Promise<string | null>`

根据用户消息搜索相关文档并构建知识上下文。

```typescript
const context = await enhancer.searchRelevantDocs(
  "How to setup docker with nginx?",
  200000
);

if (context) {
  console.log(context);
  // ## 相关文档参考
  //
  // ### 文档片段 1
  //
  // Docker Compose setup with Nginx...
  //
  // ### 文档片段 2
  //
  // Nginx configuration best practices...
}
```

**智能检测**:
- 自动检测用户消息是否需要查询文档
- 提取技术关键词（如 nginx、docker、kubernetes）
- 仅在技术问题时才搜索文档

**Token 预算控制**:
- 默认使用 10% 的模型上下文窗口
- 自动截断过长的文档内容
- 支持自定义预算百分比

## 配置选项

### KnowledgeEnhancerConfig

```typescript
interface KnowledgeEnhancerConfig {
  /**
   * 是否启用 Context7 搜索
   * @default false
   */
  enabled: boolean;

  /**
   * Context7 API Key
   */
  apiKey?: string;

  /**
   * 默认搜索源
   * @default []
   */
  defaultSources?: string[];

  /**
   * 最大搜索结果数
   * @default 3
   */
  maxResults?: number;

  /**
   * 知识上下文的 token 预算（占总 token 的百分比）
   * @default 0.1 (10%)
   */
  tokenBudgetPercent?: number;
}
```

### 推荐配置

```typescript
// 开发环境
const devConfig = {
  enabled: true,
  apiKey: process.env.CONTEXT7_API_KEY,
  defaultSources: ['nginx', 'docker'],
  maxResults: 5,
  tokenBudgetPercent: 0.15, // 15%
};

// 生产环境
const prodConfig = {
  enabled: true,
  apiKey: process.env.CONTEXT7_API_KEY,
  defaultSources: ['nginx', 'docker', 'kubernetes', 'redis'],
  maxResults: 3,
  tokenBudgetPercent: 0.1, // 10%
};
```

## 支持的文档源

Context7 支持以下文档源:

### 官方文档
- `nginx` - Nginx 官方文档
- `docker` - Docker 官方文档
- `kubernetes` - Kubernetes 官方文档
- `redis` - Redis 官方文档
- `mysql` - MySQL 官方文档
- `postgres` - PostgreSQL 官方文档
- `mongodb` - MongoDB 官方文档
- `python` - Python 官方文档
- `node` - Node.js 官方文档
- `react` - React 官方文档
- `vue` - Vue.js 官方文档

### 社区资源
- `stackoverflow` - StackOverflow
- `github` - GitHub

## 最佳实践

### 1. 控制 Token 使用

```typescript
// ❌ 不推荐: 使用过多 token
const enhancer = new KnowledgeEnhancer({
  enabled: true,
  apiKey: apiKey,
  maxResults: 10,
  tokenBudgetPercent: 0.3, // 30% 太多
});

// ✅ 推荐: 控制在合理范围
const enhancer = new KnowledgeEnhancer({
  enabled: true,
  apiKey: apiKey,
  maxResults: 3,
  tokenBudgetPercent: 0.1, // 10%
});
```

### 2. 优雅降级

```typescript
try {
  const context = await enhancer.searchRelevantDocs(userMessage, contextWindow);

  // 即使没有找到文档，也继续 AI 对话
  const systemPrompt = context
    ? `${BASE_PROMPT}\n\n${context}`
    : BASE_PROMPT;

  return await provider.chat({ messages, system: systemPrompt });
} catch (err) {
  // 搜索失败也不影响 AI 对话
  console.error('Knowledge search failed:', err);
  return await provider.chat({ messages, system: BASE_PROMPT });
}
```

### 3. 缓存搜索结果

```typescript
// 对于相同/相似的查询，缓存搜索结果
const cache = new Map<string, string>();

function getCachedContext(query: string): string | null {
  const normalized = query.toLowerCase().trim();
  return cache.get(normalized) ?? null;
}

async function getKnowledgeContext(query: string): Promise<string | null> {
  const cached = getCachedContext(query);
  if (cached) return cached;

  const context = await enhancer.searchRelevantDocs(query, contextWindow);
  if (context) {
    cache.set(query.toLowerCase().trim(), context);
  }

  return context;
}
```

## 故障排查

### 连接失败

```
Error: Context7 not connected. Call connectContext7() first.
```

**解决方案**: 确保在调用 `searchDocs()` 前先调用 `initialize()`。

### API Key 无效

```
Error: Context7 search failed: Invalid API key
```

**解决方案**: 检查环境变量 `CONTEXT7_API_KEY` 是否正确设置。

### 搜索超时

```
Error: Context7 search failed: Request timeout
```

**解决方案**:
1. 检查网络连接
2. 减少 `maxResults`
3. 简化搜索查询

## 未来计划

- [ ] 支持 GitHub MCP Server（代码搜索、Issue、PR）
- [ ] 支持 Jira MCP Server（工单管理）
- [ ] 支持自定义 MCP Server
- [ ] 搜索结果缓存优化
- [ ] 基于 LLM 的智能关键词提取

## 参考资料

- [MCP 官方文档](https://modelcontextprotocol.io/)
- [Context7 文档](https://context7.com/docs)
- [Anthropic MCP SDK](https://github.com/anthropics/anthropic-sdk-typescript)
