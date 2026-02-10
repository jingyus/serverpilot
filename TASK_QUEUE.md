# ServerPilot 任务队列

> AI 自动生成的开发任务队列

---

## 📊 统计信息

- **总任务数**: 10
- **待完成** (pending): 10
- **进行中** (in_progress): 0
- **已完成** (completed): 0
- **失败** (failed): 0

---

## 📋 任务列表

<!-- 任务将由 AI 自动生成和更新 -->
### [pending] 完成 Settings 页面功能实现

**ID**: task-001
**优先级**: P0
**模块路径**: packages/dashboard/src/pages/Settings.tsx
**任务描述**: 
Settings 页面目前只是一个空壳，需要实现完整的设置功能：
1. AI Provider 配置（API Key、模型选择）
2. 用户个人信息管理
3. 系统通知偏好设置
4. 安全设置（密码修改、会话管理）
5. 知识库配置（自动学习开关、文档源管理）

**产品需求**: MVP Dashboard 基础框架 - Settings 页面是用户配置平台的核心入口
**验收标准**: 
- [ ] 可以查看和修改 AI Provider 配置
- [ ] 可以修改用户个人信息
- [ ] 可以配置通知偏好
- [ ] UI 使用 Shadcn/ui 组件保持一致性
- [ ] 所有配置修改实时生效

**创建时间**: 2026-02-10 23:35:00
**完成时间**: -

---

### [pending] 实现 Agent WebSocket 命令实时执行

**ID**: task-002
**优先级**: P0
**模块路径**: packages/server/src/api/routes/chat.ts
**任务描述**:
当前代码中有 TODO: "Send command to agent via WebSocket and await response"。需要实现：
1. 在 chat.ts 中通过 WebSocket 发送命令到 Agent
2. 等待 Agent 返回执行结果
3. 处理超时和错误情况
4. 支持实时输出流式返回

**产品需求**: AI 对话引擎 - 命令执行是对话的核心闭环
**验收标准**:
- [ ] 可以通过 WebSocket 发送命令到 Agent
- [ ] 可以接收 Agent 的实时输出（stdout/stderr）
- [ ] 可以获取命令执行结果（exitCode）
- [ ] 超时机制完善（默认 300 秒）
- [ ] 错误处理完整（连接失败、Agent 离线等）

**创建时间**: 2026-02-10 23:35:00
**完成时间**: -

---

### [pending] 实现 AI Token 计数精确统计

**ID**: task-003
**优先级**: P1
**模块路径**: packages/server/src/api/handlers.ts
**任务描述**:
当前代码中有 TODO: "Get actual token counts from AI agent"。需要：
1. 从 AI Provider 响应中提取实际 token 使用量
2. 更新 operation 记录的 inputTokens 和 outputTokens
3. 为不同 Provider（OpenAI、Claude、DeepSeek）实现统一的 token 计数接口
4. 添加 token 使用量统计报表功能

**产品需求**: AI 质量与可靠性 - 成本预估和用量追踪
**验收标准**:
- [ ] OpenAI Provider 返回精确 token 计数
- [ ] Claude Provider 返回精确 token 计数
- [ ] DeepSeek Provider 返回精确 token 计数
- [ ] Ollama 本地模型支持 token 计数（如果可用）
- [ ] operation 表正确记录 token 使用量
- [ ] 编写单元测试覆盖 token 计数逻辑

**创建时间**: 2026-02-10 23:35:00
**完成时间**: -

---

### [pending] 实现文档源更新历史跟踪

**ID**: task-004
**优先级**: P1
**模块路径**: packages/server/src/knowledge/doc-auto-fetcher.ts
**任务描述**:
当前代码中有 TODO: "Store and use previous SHA/hash from source metadata"。需要：
1. 在数据库 docSources 表中添加 lastSha/lastHash 字段
2. 每次抓取前检查 SHA/Hash 是否变化
3. 只在文档更新时重新抓取和向量化
4. 记录更新历史日志

**产品需求**: 知识库自成长 - 文档自动抓取功能
**验收标准**:
- [ ] docSources 表包含 lastSha、lastHash、lastUpdateTime 字段
- [ ] 抓取前检查 SHA/Hash 变化
- [ ] 未变化的文档跳过抓取
- [ ] 更新历史记录到 docSourceHistory 表
- [ ] 编写单元测试验证增量更新逻辑

**创建时间**: 2026-02-10 23:35:00
**完成时间**: -

---

### [pending] 添加知识库搜索前端页面

**ID**: task-005
**优先级**: P2
**模块路径**: packages/dashboard/src/pages/SearchPage.tsx
**任务描述**:
需要创建一个完整的知识库搜索页面：
1. 搜索输入框（支持关键词搜索）
2. 搜索结果列表（显示相关知识条目）
3. 相似度评分展示
4. 知识来源标识（内置知识库/自动学习/文档抓取）
5. 知识详情查看

**产品需求**: 知识库系统 - RAG 检索可视化界面
**验收标准**:
- [ ] 搜索输入框支持实时搜索
- [ ] 结果列表展示知识标题、摘要、来源
- [ ] 显示相似度评分（0-1）
- [ ] 可以查看知识详情（完整内容）
- [ ] 支持知识分类筛选
- [ ] 响应式设计适配移动端

**创建时间**: 2026-02-10 23:35:00
**完成时间**: -

---

### [pending] 完善实时监控数据聚合

**ID**: task-006
**优先级**: P1
**模块路径**: packages/server/src/api/routes/metrics.ts
**任务描述**:
当前监控页面已有 UI，但需要完善数据聚合逻辑：
1. 实现 Metrics 数据定时采集（CPU、内存、磁盘、网络）
2. 实现数据聚合 API（按时间区间聚合）
3. 实现数据清理机制（保留策略：7 天原始数据，30 天小时数据，1 年天数据）
4. 优化查询性能（索引优化）

**产品需求**: 基本监控图表 - 实时监控是运维平台的基础功能
**验收标准**:
- [ ] Agent 每分钟上报一次 Metrics 数据
- [ ] Server 正确存储 Metrics 数据到数据库
- [ ] API 支持按时间范围查询聚合数据
- [ ] 实现数据清理定时任务
- [ ] Dashboard 图表正确展示监控数据
- [ ] 查询性能优化（响应时间 < 500ms）

**创建时间**: 2026-02-10 23:35:00
**完成时间**: -

---

### [pending] 增强命令安全审计规则库

**ID**: task-007
**优先级**: P1
**模块路径**: packages/agent/src/security/command-classifier.ts
**任务描述**:
当前命令分类器已有基础实现，需要增强规则库：
1. 扩展命令分级规则（GREEN/YELLOW/RED/CRITICAL/FORBIDDEN）
2. 添加更多危险命令识别规则
3. 增强参数审计规则（危险参数、保护路径）
4. 添加命令别名识别（sudo、su、doas 等）
5. 支持用户自定义规则

**产品需求**: 安全架构 - 命令分级制度是五层防御的第一层
**验收标准**:
- [ ] 规则库覆盖 100+ 常见命令
- [ ] 支持正则表达式和通配符匹配
- [ ] 别名识别准确（sudo rm = rm）
- [ ] 参数审计识别 --force、-rf 等危险参数
- [ ] 保护路径包含 /etc、/boot、/var/lib/*
- [ ] 编写测试覆盖所有规则
- [ ] 支持从配置文件加载自定义规则

**创建时间**: 2026-02-10 23:35:00
**完成时间**: -

---

### [pending] 实现端到端集成测试

**ID**: task-008
**优先级**: P0
**模块路径**: tests/e2e/
**任务描述**:
项目已有单元测试，需要添加端到端测试：
1. 用户注册/登录流程测试
2. 添加服务器流程测试
3. AI 对话 → 计划生成 → 命令执行完整流程测试
4. 定时任务创建和执行测试
5. 告警触发和通知测试
6. 快照和回滚测试

**产品需求**: 测试与质量保证 - 确保核心功能闭环可用
**验收标准**:
- [ ] 使用 Playwright 编写 E2E 测试
- [ ] 覆盖 6 个核心用户流程
- [ ] 测试通过率 100%
- [ ] 可以在 CI/CD 中自动运行
- [ ] 生成测试报告和截图
- [ ] 测试执行时间 < 5 分钟

**创建时间**: 2026-02-10 23:35:00
**完成时间**: -

---

### [pending] 优化 Docker Compose 部署体验

**ID**: task-009
**优先级**: P1
**模块路径**: docker-compose.yml
**任务描述**:
当前 Docker Compose 配置已完成，需要优化部署体验：
1. 添加一键初始化脚本（init.sh）
2. 自动生成默认管理员账户
3. 自动配置 AI Provider（引导式配置）
4. 添加健康检查和启动等待逻辑
5. 优化镜像大小（多阶段构建）
6. 添加 docker-compose.dev.yml（开发模式）

**产品需求**: 部署方式 - `docker compose up` 一键自部署
**验收标准**:
- [ ] 运行 `docker compose up -d` 可以完整启动
- [ ] 首次启动自动初始化数据库
- [ ] 引导用户配置 AI Provider
- [ ] 健康检查通过后才标记为就绪
- [ ] Server 镜像大小 < 200MB
- [ ] Dashboard 镜像大小 < 50MB
- [ ] 编写 README 部署指南

**创建时间**: 2026-02-10 23:35:00
**完成时间**: -

---

### [pending] 完善 API 文档和 OpenAPI 规范

**ID**: task-010
**优先级**: P2
**模块路径**: docs/API文档.md
**任务描述**:
需要生成完整的 API 文档：
1. 使用 Swagger/OpenAPI 3.0 规范描述所有 API
2. 自动生成 API 参考文档
3. 添加请求/响应示例
4. 集成到项目文档站点
5. 支持 API 在线测试（Swagger UI）

**产品需求**: 文档完善 - 为开源社区和开发者提供清晰文档
**验收标准**:
- [ ] 使用 @hono/zod-openapi 生成 OpenAPI 规范
- [ ] 覆盖所有 22 个路由模块
- [ ] 每个端点包含完整的请求/响应示例
- [ ] 集成 Swagger UI（访问 /api-docs）
- [ ] 可以在线测试 API
- [ ] 文档自动更新（代码即文档）

**创建时间**: 2026-02-10 23:35:00
**完成时间**: -


---

## 使用说明

### 任务状态
- `[pending]` - 待执行
- `[in_progress]` - 执行中
- `[completed]` - 已完成
- `[failed]` - 失败（需要人工介入）

### 任务格式示例
```
[状态] 任务名称

ID: task-001
优先级: P0
模块路径: packages/server/src/
任务描述: xxx
产品需求: xxx
验收标准: xxx
创建时间: 2026-02-10 23:00:00
完成时间: -
```

---

**最后更新**: 2026-02-10 23:42:43
