# Skill ↔ Chat ↔ Context7 集成设计

## 概述

本文档描述 **Skill 定时任务**、**AI 对话（Chat）** 和 **Context7 MCP 知识增强** 三个系统之间的集成点。

## 系统关系图

```
┌──────────────┐
│   Context7   │  (Cloud 包, MCP 知识搜索)
│     MCP      │
└──────┬───────┘
       │
       │ 知识增强
       ↓
┌──────────────┐     AI工具调用      ┌──────────────┐
│   Chat AI    │ ←─────────────────→ │    Skills    │
│   (Server)   │                     │  (Server)    │
└──────┬───────┘                     └──────┬───────┘
       │                                     │
       │ 错误诊断                             │ 定时执行
       ↓                                     ↓
┌──────────────┐                     ┌──────────────┐
│    Tasks     │ ←───────────────────│    Agent     │
│  Scheduler   │    执行结果反馈        │              │
└──────────────┘                     └──────────────┘
```

## 集成点 1: Chat AI → Skill（对话创建任务）

### 场景
用户通过自然语言创建定时任务：
```
User: "帮我设置一个每天备份 /var/www 的任务"
AI: 识别意图 → 推荐 backup skill → 询问参数 → 创建 Task
```

### 实现
- **AI Tools**：`chat-integration.ts` 提供以下工具函数
  - `listSkillTemplatesForAI()` - 列出可用 Skill
  - `recommendSkillsForAI(intent)` - 推荐合适的 Skill
  - `validateSkillConfigForAI(name, config)` - 验证配置
  - `createSkillTaskForAI(input)` - 创建任务

- **Chat 集成**：在 `chat-ai.ts` 中注册为 AI tools，供 Claude 调用

### 工作流程
1. 用户输入意图 → AI 识别关键词
2. AI 调用 `recommendSkillsForAI()` 获取推荐
3. AI 向用户确认 Skill 和配置参数
4. AI 调用 `validateSkillConfigForAI()` 验证
5. AI 调用 `createSkillTaskForAI()` 创建 Task
6. Task Scheduler 自动调度执行

## 集成点 2: Skill → Chat（失败诊断）

### 场景
Skill 任务执行失败，AI 自动分析并提供修复建议：
```
Task: backup 失败 (exit code 1, stderr: "mysqldump: command not found")
AI: 诊断 → 缺少 mysql-client → 建议安装命令
```

### 实现
- **已有实现**：`error-diagnosis-service.ts` 的 `autoDiagnoseStepFailure()`
- **增强点**：为 Skill 任务失败添加专门的诊断逻辑

### 工作流程
1. Task Scheduler 执行 Skill 任务失败
2. 调用 `autoDiagnoseStepFailure()` 分析错误
3. 根据 Skill 类型提供针对性建议
4. 通过 Webhook 或 SSE 通知用户

## 集成点 3: Chat → Context7（技术文档搜索）

### 场景
用户询问技术问题时，AI 搜索官方文档：
```
User: "nginx 如何配置反向代理 WebSocket?"
AI: 调用 Context7 → 搜索 nginx 文档 → 返回配置示例
```

### 实现
- **已有实现**：Cloud 包的 `knowledge-enhancer.ts`
- **集成方式**：Server 包的 Chat AI 通过 HTTP API 调用 Cloud 服务

### 工作流程
1. 用户输入技术问题
2. Chat AI 检测到技术关键词
3. 调用 Cloud API `/api/v1/knowledge/search`
4. Cloud 使用 Context7 MCP 搜索文档
5. 返回搜索结果注入 AI 上下文
6. AI 基于文档生成回答

## 集成点 4: Skill失败 → Context7（故障排查）

### 场景
Skill 任务失败，自动搜索相关文档找解决方案：
```
Task: backup 失败 (mysqldump error)
System: 调用 Context7 搜索 "mysql backup troubleshooting"
AI: 基于搜索结果提供诊断和修复方案
```

### 实现
- **新功能**：`skill-failure-diagnosis.ts`（待实现）
- **流程**：
  1. 检测 Skill 任务失败
  2. 提取错误信息和 Skill 类型
  3. 构建搜索查询（如 "mysql backup error"）
  4. 调用 Context7 MCP 搜索文档
  5. 将文档内容提供给 AI 分析
  6. 生成诊断报告

### 实现位置
**Cloud 包**（因为依赖 Context7 MCP）：
- `packages/cloud/src/skills/failure-diagnosis.ts`

## 集成点 5: Context7 → Skill（文档推荐）

### 场景
Context7 搜索到的文档建议执行某些操作，AI 推荐对应 Skill：
```
User: "如何优化 nginx 性能?"
Context7: 返回文档（建议清理日志、监控磁盘等）
AI: "我注意到文档建议清理日志，要不要设置一个定时任务？"
     + 推荐 log-cleanup skill
```

### 实现
- **增强 AI 推理**：在 Chat AI 的 system prompt 中添加 Skill 推荐逻辑
- 当 Context7 返回的文档包含操作建议时，AI 自动匹配相关 Skill

### 工作流程
1. 用户询问问题 → Context7 搜索文档
2. AI 分析文档内容，识别操作建议
3. 调用 `recommendSkillsForAI()` 匹配 Skill
4. 向用户推荐设置定时任务

## API 端点总结

### Server 包 API

#### Skill 模板相关
- `GET /api/v1/tasks/templates` - 列出 Skill 模板
- `POST /api/v1/tasks/from-template` - 从模板创建任务

#### Chat AI 调用（内部函数，非 HTTP）
- `listSkillTemplatesForAI()`
- `recommendSkillsForAI(intent)`
- `validateSkillConfigForAI(name, config)`
- `createSkillTaskForAI(input)`
- `listUserSkillTasksForAI(userId)`

### Cloud 包 API（待实现）

#### 知识搜索
- `POST /api/v1/knowledge/search` - 搜索技术文档
  ```json
  {
    "query": "nginx reverse proxy websocket",
    "sources": ["nginx", "docker"],
    "contextWindow": 200000
  }
  ```

#### Skill 失败诊断
- `POST /api/v1/skills/diagnose` - 诊断 Skill 失败原因
  ```json
  {
    "skillName": "backup",
    "error": "mysqldump: command not found",
    "stderr": "...",
    "serverId": "xxx"
  }
  ```

## 实现优先级

### 已完成 ✅
1. Skill 模板系统（disk-check, backup, log-cleanup）
2. Skill Registry 和配置验证
3. Skill → Task 转换
4. Chat → Skill 集成工具（`chat-integration.ts`）
5. Context7 MCP 基础集成（Cloud 包）

### 待实现 🔲
1. 在 Chat AI 中注册 Skill tools
2. Cloud 包的 Skill 失败诊断服务
3. 在 AI system prompt 中添加 Skill 推荐逻辑
4. 完善错误诊断对 Skill 的支持

## 使用示例

### 示例 1: 对话创建备份任务

```
User: 帮我设置一个每天备份数据库的任务

AI: 好的,我推荐使用 backup skill。请提供以下信息:
    1. 备份类型: mysql/postgresql/mongodb?
    2. 数据库名称?
    3. 备份保存目录?
    4. 保留最近几天的备份?

User: mysql, myapp_db, /backup, 保留 7 天

AI: [调用 createSkillTaskForAI()]
    任务创建成功！每天凌晨 2 点自动备份 myapp_db 到 /backup,
    保留最近 7 个备份文件。
```

### 示例 2: Skill 失败诊断

```
[System] Task "backup-mysql" failed
        Error: "mysqldump: command not found"

[Auto Diagnosis]
1. 检测到缺少 mysqldump 命令
2. 调用 Context7 搜索 "install mysql-client ubuntu"
3. AI 生成诊断报告:
   - 问题: 未安装 mysql-client
   - 解决: sudo apt-get install mysql-client
   - 建议: 安装后重新运行任务

[Notification] 通过 Webhook 发送诊断结果给用户
```

### 示例 3: 文档推荐 Skill

```
User: nginx 日志太多,占用了很多磁盘空间

AI: [调用 Context7 搜索 "nginx log management"]
    [返回文档] 建议定期清理日志、设置 logrotate 等

AI: 我发现您的日志占用空间较大。除了 nginx 自带的 logrotate,
    我可以帮您设置一个定时任务来清理过期日志。

    要不要设置一个 log-cleanup 任务?
    - 每天凌晨 3 点执行
    - 清理 /var/log/nginx 中超过 30 天的日志
    - 可选:压缩 7 天前的旧日志而不是直接删除

User: 好的,设置一下

AI: [调用 createSkillTaskForAI()]
    任务创建成功！
```

## 总结

通过这些集成点,我们实现了:

1. **Chat → Skill**: 用户通过自然语言创建和管理定时任务
2. **Skill → Chat**: 任务失败时自动诊断并提供修复建议
3. **Chat → Context7**: 技术问题搜索官方文档
4. **Skill → Context7**: 失败任务搜索故障排查文档
5. **Context7 → Skill**: 文档推荐相关的自动化任务

形成一个完整的 **智能运维闭环**。
