# ServerPilot 开发任务清单

> **目标**: AI 驱动的智能运维平台 - 完成 MVP 核心闭环
> **创建时间**: 2026-02-09
> **参考文档**: 技术方案 v1.0 / 产品方案 v2.2

---

## 进度概览

```
Phase 1: MVP 核心闭环 (6 周)          [进行中] ░░░░░░░░░░ 0%
Phase 2: 安全与体验 (4 周)            [待开发] ░░░░░░░░░░ 0%
Phase 3: 开源发布 (4 周)              [待开发] ░░░░░░░░░░ 0%
Phase 4: 云版发布 (4 周)              [待开发] ░░░░░░░░░░ 0%
```

---

## Phase 1: MVP 核心闭环 (v0.1)

### 🏆 P0 - 最高优先级 (必须完成)

#### Week 1-2: Dashboard 基础框架

| 任务 | 路径 | 状态 | 说明 |
|------|------|------|------|
| React 项目初始化 | `packages/dashboard/` | ✅ 完成 | Vite + React 18 + TypeScript |
| UI 组件库配置 | `packages/dashboard/` | ✅ 完成 | Shadcn/ui + Tailwind CSS |
| 登录/注册页面 | `pages/Login.tsx` | ✅ 完成 | 本地账户验证 |
| 主布局框架 | `components/layout/` | ✅ 完成 | Sidebar + Header + MainLayout |
| 服务器列表页 | `pages/Servers.tsx` | ✅ 完成 | 展示服务器状态、快速入口 |
| 服务器详情页 | `pages/ServerDetail.tsx` | ✅ 完成 | 监控、服务、软件清单 |
| 添加服务器流程 | `components/server/` | ✅ 完成 | 生成安装命令、令牌管理 |

#### Week 3-4: Server API + AI 对话

| 任务 | 路径 | 状态 | 说明 |
|------|------|------|------|
| REST API 路由框架 | `packages/server/src/api/routes/` | ✅ 完成 | Hono 路由配置 |
| JWT 认证中间件 | `packages/server/src/api/middleware/auth.ts` | ✅ 完成 | Token 生成/验证 |
| 服务器管理 API | `routes/servers.ts` | ✅ 完成 | CRUD + 状态查询 |
| AI 对话界面 | `pages/Chat.tsx` | ✅ 完成 | 对话输入、计划预览、实时输出 |
| 对话 API (SSE) | `routes/chat.ts` | ✅ 完成 | 流式响应、计划生成 |
| 执行 API | `routes/chat.ts` | ✅ 完成 | 计划执行、进度推送 |
| 会话管理器 | `core/session/manager.ts` | ✅ 完成 | 对话上下文、历史管理 |
| 档案管理器 | `core/profile/manager.ts` | ✅ 完成 | 服务器档案 CRUD |

#### Week 5-6: 数据库 + 安全机制

| 任务 | 路径 | 状态 | 说明 |
|------|------|------|------|
| 数据库 Schema | `packages/server/src/db/schema.ts` | ✅ 完成 | Drizzle ORM + SQLite |
| 数据库迁移 | `packages/server/src/db/migrations/` | ✅ 完成 | 初始化迁移脚本 |
| Repository 层 | `packages/server/src/db/repositories/` | ✅ 完成 | 数据访问封装 |
| 任务执行器 | `core/task/executor.ts` | ✅ 完成 | 命令下发、结果处理 |
| 命令分级器 | `packages/agent/src/security/command-classifier.ts` | ✅ 完成 | 5 级风险分类 |
| 参数审计器 | `packages/agent/src/security/param-auditor.ts` | ✅ 完成 | 危险参数/路径检测 |

---

### 🔵 P1 - 高优先级

| 任务 | 路径 | 状态 | 说明 |
|------|------|------|------|
| OpenAI Provider | `ai/providers/openai.ts` | ✅ 完成 | GPT-4o 集成 (流式/重试/成本估算/结构化输出) |
| Ollama Provider | `ai/providers/ollama.ts` | ✅ 完成 | 本地模型支持 |
| DeepSeek Provider | `ai/providers/deepseek.ts` | ✅ 完成 | 国内用户首选 |
| AI 质量检查器 | `ai/quality-checker.ts` | ✅ 完成 | 输出验证、模板匹配 |
| 服务发现 | `packages/agent/src/detect/services.ts` | ✅ 完成 | systemd/pm2/docker 服务探测 |
| 状态管理 | `packages/dashboard/src/stores/` | ✅ 完成 | Zustand 状态设计 |
| WebSocket 客户端 | `packages/dashboard/src/api/websocket.ts` | ✅ 完成 | 实时通信 |

---

### 🟢 P2 - 中优先级

| 任务 | 路径 | 状态 | 说明 |
|------|------|------|------|
| 端口扫描 | `packages/agent/src/detect/ports.ts` | ✅ 完成 | 开放端口探测 |
| 响应式设计 | Dashboard 全局 | ✅ 完成 | 移动端适配 |
| 错误边界 | `components/common/ErrorBoundary.tsx` | ✅ 完成 | 全局错误处理 |
| Loading 状态 | `components/common/Loading.tsx` | ✅ 完成 | 加载状态组件 |

---

## Phase 2: 安全与体验 (v0.2)

> Week 7-10: 在 MVP 基础上增强安全性和用户体验

| 任务 | 优先级 | 状态 | 说明 |
|------|--------|------|------|
| 操作前快照 | P0 | ✅ 完成 | 自动创建配置/数据快照 |
| 一键回滚 | P0 | ✅ 完成 | 基于快照恢复 |
| 完整服务器档案 | P0 | ✅ 完成 | 历史摘要 + 注意事项 + 偏好 |
| 操作历史记录 | P0 | ✅ 完成 | 全量日志、可追溯 |
| 定时任务 | P1 | ✅ 完成 | 对话创建 + 手动创建 + Cron |
| 基本监控图表 | P1 | ✅ 完成 | CPU/内存/磁盘曲线 |
| 告警规则 | P1 | ✅ 完成 | 阈值配置 + 邮件通知 |
| Agent 自动更新 | P1 | ✅ 完成 | Ed25519 签名验证 |
| 知识库自动学习 | P2 | ✅ 完成 | 成功操作自动沉淀 |
| 文档自动抓取 | P2 | ✅ 完成 | GitHub/官网文档解析 |

---

## Phase 3: 开源发布 (v0.3)

> Week 11-14: 准备开源发布，完善文档和 CI/CD

| 任务 | 优先级 | 状态 | 说明 |
|------|--------|------|------|
| README 完善 | P0 | ⬜ 待开发 | 项目介绍、快速开始 |
| 安装指南 | P0 | ⬜ 待开发 | 各平台安装文档 |
| 贡献指南 | P0 | ⬜ 待开发 | CONTRIBUTING.md |
| 安全白皮书 | P0 | ⬜ 待开发 | 五层防御架构说明 |
| CI/CD 流水线 | P0 | ⬜ 待开发 | GitHub Actions |
| Docker Hub 发布 | P0 | ⬜ 待开发 | 官方镜像 |
| 一键安装脚本 | P0 | ⬜ 待开发 | curl | bash 安装 |
| 更多 AI Provider | P1 | ⬜ 待开发 | 自定义 OpenAI 兼容接口 |
| 知识库贡献指南 | P1 | ⬜ 待开发 | 社区贡献入口 |
| Product Hunt 发布 | P2 | ⬜ 待开发 | 社区推广 |

---

## Phase 4: 云版发布 (v1.0)

> Week 15-18: 商业化云版本

| 任务 | 优先级 | 状态 | 说明 |
|------|--------|------|------|
| 多租户架构 | P0 | ⬜ 待开发 | 数据隔离、资源配额 |
| 用户系统 | P0 | ⬜ 待开发 | 邮箱 + GitHub OAuth |
| 计费系统 | P0 | ⬜ 待开发 | Stripe 集成 |
| 团队协作 | P1 | ⬜ 待开发 | 邀请成员、角色权限 |
| 操作审计报告 | P1 | ⬜ 待开发 | 合规导出 |
| Webhook 通知 | P1 | ⬜ 待开发 | 外部集成 |
| 社区知识共享 | P2 | ⬜ 待开发 | opt-in 知识聚合 |
| 高可用部署 | P2 | ⬜ 待开发 | PostgreSQL + 多副本 |

---

## 长期规划

| 版本 | 主要功能 | 状态 |
|------|---------|------|
| v1.1 | 移动端 App (状态查看、审批操作) | 📋 规划中 |
| v1.2 | 应用商店 + 插件系统 | 📋 规划中 |
| v1.3 | 多云支持 (AWS/阿里云/腾讯云) | 📋 规划中 |
| v1.4 | AI 主动运维 (预测性维护) | 📋 规划中 |
| v1.5 | 批量操作 + 服务器分组 | 📋 规划中 |
| v2.0 | Kubernetes 集群管理 | 📋 规划中 |

---

## 已完成模块 (可复用)

> 这些模块已在前期开发中完成，可直接集成

| 模块 | 路径 | 状态 |
|------|------|------|
| AI Agent | `packages/server/src/ai/agent.ts` | ✅ 完成 |
| AI Planner | `packages/server/src/ai/planner.ts` | ✅ 完成 |
| 错误诊断器 | `packages/server/src/ai/error-analyzer.ts` | ✅ 完成 |
| 容错降级 | `packages/server/src/ai/fault-tolerance.ts` | ✅ 完成 |
| 流式响应 | `packages/server/src/ai/streaming.ts` | ✅ 完成 |
| 知识库加载 | `packages/server/src/knowledge/loader.ts` | ✅ 完成 |
| 向量数据库 | `packages/server/src/knowledge/vectordb.ts` | ✅ 完成 |
| 文本分块 | `packages/server/src/knowledge/text-chunker.ts` | ✅ 完成 |
| 上下文增强 | `packages/server/src/knowledge/context-enhancer.ts` | ✅ 完成 |
| WebSocket 服务 | `packages/server/src/api/server.ts` | ✅ 完成 |
| 消息处理 | `packages/server/src/api/handlers.ts` | ✅ 完成 |
| Agent 认证 | `packages/server/src/api/auth-handler.ts` | ✅ 完成 |
| 环境探测 | `packages/agent/src/detect/*` | ✅ 完成 |
| 命令执行器 | `packages/agent/src/execute/executor.ts` | ✅ 完成 |
| 沙箱执行 | `packages/agent/src/execute/sandbox.ts` | ✅ 完成 |
| 快照系统 | `packages/agent/src/execute/snapshot.ts` | ✅ 完成 |
| CLI 界面 | `packages/agent/src/ui/*` | ✅ 完成 |
| 协议定义 | `packages/shared/src/protocol/*` | ✅ 完成 |

---

## 测试覆盖率目标

| 模块 | 目标覆盖率 |
|------|-----------|
| 安全模块 (命令分级、参数审计) | ≥ 95% |
| AI 质量防线 | ≥ 90% |
| 通信协议 | ≥ 85% |
| Dashboard UI | ≥ 70% |
| 整体代码 | ≥ 80% |

---

## 状态说明

- ⬜ 待开发
- 🔄 进行中
- ✅ 已完成
- ⏸️ 暂停
- ❌ 取消

---

*最后更新: 2026-02-09*
