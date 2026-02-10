# autorun.sh 开发文档

> AI 自循环开发脚本 - 设计与实现记录

---

## 概述

`autorun.sh` 是 ServerPilot 项目的 AI 自动化开发脚本，通过 Claude Code CLI 实现：
- **自动分析**：AI 读取产品方案和技术文档，分析当前代码完成度
- **任务生成**：自动选择最重要的待开发任务
- **代码实现**：AI 自动编写代码
- **测试验证**：运行测试确保质量
- **循环执行**：完成后继续下一个任务

---

## 设计思路

### 核心理念

```
传统开发: 人工阅读文档 → 人工编写代码 → 人工测试 → 人工修复
AI 自循环: AI 分析 → AI 编码 → 自动测试 → AI 修复 → 循环
```

### 工作流程

```
┌─────────────────────────────────────────────────┐
│  阶段 1: 分析项目 (Analysis Phase)               │
│  · 读取产品方案目录 (docs/产品方案-目录.md)      │
│  · 读取技术方案 (docs/SERVERPILOT技术方案.md)  │
│  · 分析代码完成度                                │
│  · 选择最重要的任务                              │
│  · 生成任务描述                                  │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│  阶段 2: 执行任务 (Execution Phase)              │
│  · AI 读取当前任务                               │
│  · 实现功能代码                                  │
│  · 编写测试用例                                  │
│  · 生成文档                                      │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│  阶段 3: 验证质量 (Testing Phase)                │
│  · 运行测试套件                                  │
│  · 如果失败 → 让 AI 修复                        │
│  · 再次测试                                      │
│  · 记录结果                                      │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│  阶段 4: Git 提交 (Git Commit Phase)             │
│  · 自动 git add 变更文件                         │
│  · 根据任务名生成 commit message                │
│  · 提交到 feat/autorun-dev-{date} 分支          │
│  · Push 到远程仓库（如果配置）                   │
└─────────────────────────────────────────────────┘
                    ↓
               等待 30 秒
                    ↓
              继续下一轮循环
```

---

## 技术实现

### 脚本结构

```bash
autorun.sh
├── 环境检查 (check_environment)
│   ├── Node.js / pnpm
│   ├── Claude Code CLI
│   └── 文档文件
│
├── 状态管理 (init_state_file, record_state)
│   ├── AUTORUN_STATE.md - 轮次历史
│   ├── CURRENT_TASK.md - 当前任务
│   └── autorun.log - 详细日志
│
├── AI 分析阶段 (run_claude_analyze)
│   ├── build_analyze_prompt - 构建分析提示词
│   ├── 超时控制 (30分钟)
│   ├── 心跳检测（防止卡死）
│   └── 任务格式验证
│
├── AI 执行阶段 (run_claude_execute)
│   ├── build_execute_prompt - 构建执行提示词
│   ├── 超时控制 (30分钟)
│   └── 实时进度显示
│
├── 测试阶段 (run_tests)
│   ├── 运行 pnpm test
│   ├── 失败时调用 AI 修复 (run_claude_fix)
│   └── 记录测试日志
│
├── Git 提交阶段 (run_git_commit) - 新增
│   ├── 检测文件变更
│   ├── 生成 commit message
│   ├── 提交到开发分支
│   └── 可选：推送到远程
│
└── 主循环 (main)
    ├── 防睡眠机制 (caffeinate)
    ├── 错误重试 (最多3次)
    └── 循环间隔控制
```

### 关键特性

#### 1. 超时和心跳机制

```bash
# 防止 Claude 卡死的双重保护
- 全局超时：30 分钟强制终止
- 心跳检测：30 分钟无输出视为卡死
```

#### 2. 重试策略

```bash
# 每个阶段都有 3 次重试机会
- 分析失败 → 重试 3 次 → 跳过本轮
- 执行失败 → 重试 3 次 → 标记为失败
- 测试失败 → AI 修复 → 再测试 → 重试
```

#### 3. 防睡眠

```bash
# macOS 使用 caffeinate 防止系统睡眠
caffeinate -disu -w $$ &
```

#### 4. 状态追踪

```bash
AUTORUN_STATE.md   # 历史记录（成功/失败）
CURRENT_TASK.md    # 当前任务详情
autorun.log        # 详细执行日志
```

---

## Prompt 设计

### 分析阶段 Prompt

目标：让 AI 理解项目现状，选择最重要的任务

```
关键指令：
1. 先读产品方案目录（精简版）
2. 参考技术方案（详细实现）
3. 检查代码完成状态
4. 按优先级选择任务
5. 输出标准格式的任务描述
```

输出格式要求：
```task
任务名称: [具体任务名]
模块路径: [如 packages/server/src/]
任务描述: [详细说明]
产品需求: [对应功能点]
验收标准: [如何验证]
```

### 执行阶段 Prompt

目标：让 AI 实现具体功能

```
关键要求：
1. 对照产品方案确保符合 MVP 范围
2. 按技术方案的设计实现
3. 遵循代码规范（TypeScript + Zod）
4. 编写单元测试
5. 只实现当前任务，不过度设计
```

### 修复阶段 Prompt

目标：让 AI 分析测试失败并修复

```
提供信息：
- 测试输出的最后 100 行
- 失败的测试用例
- 错误堆栈

修复要求：
- 不删除或跳过测试
- 修复代码而非修改测试预期
- 确保不引入新问题
```

---

## Git 集成方案

### 自动提交流程

```bash
每轮完成后：
1. 检测文件变更 (git status)
2. 如果有变更：
   a. 创建/切换到 feat/autorun-dev-{date} 分支
   b. git add 所有变更文件
   c. 生成 commit message（基于任务名）
   d. git commit
   e. 可选：git push origin {branch}
3. 记录 commit SHA 到 AUTORUN_STATE.md
```

### Commit Message 格式

遵循开发标准（参考 docs/开发标准.md）：

```
feat: {任务名称}

{任务描述摘要}

Generated-By: autorun.sh (AI-driven development)
Task-File: CURRENT_TASK.md
Round: {轮次}
Status: {✅ 完成 / ❌ 失败}
```

示例：
```
feat: 文档自动抓取功能集成与测试

为 doc-auto-fetcher.ts 编写完整测试用例，覆盖定时调度、
多源并发抓取、更新检测、错误处理等场景

Generated-By: autorun.sh (AI-driven development)
Task-File: CURRENT_TASK.md
Round: 3
Status: ✅ 完成
```

---

## 配置说明

### 环境变量

```bash
# Claude Code 认证（必需）
# 通过 `claude auth` 设置

# Git 配置（推荐）
git config user.name "ServerPilot Bot"
git config user.email "bot@serverpilot.dev"
```

### 脚本配置

在 `autorun.sh` 头部可调整：

```bash
INTERVAL=30            # 循环间隔（秒）
MAX_ITERATIONS=1000    # 最大迭代次数
ANALYZE_TIMEOUT=1800   # 分析超时（30分钟）
EXECUTE_TIMEOUT=1800   # 执行超时（30分钟）
MAX_RETRIES=3          # 单任务最大重试次数
```

---

## 使用方法

### 启动自循环开发

```bash
cd /path/to/ServerPilot
./scripts/autorun.sh
```

### 查看实时日志

```bash
tail -f autorun.log
```

### 查看开发状态

```bash
cat AUTORUN_STATE.md
```

### 查看当前任务

```bash
cat CURRENT_TASK.md
```

### 停止执行

```bash
# 在运行终端按 Ctrl+C
# 或者从另一个终端：
pkill -f autorun.sh
```

---

## 最佳实践

### 1. 产品方案先行

确保 `docs/产品方案-目录.md` 清晰定义：
- MVP 范围
- 功能优先级
- 验收标准

### 2. 合理的任务粒度

- **太大**：AI 可能超时或遗漏细节
- **太小**：循环开销大，效率低
- **最佳**：1-2 小时可完成的独立模块

### 3. 定期检查 Git 历史

```bash
# 查看自动提交历史
git log --oneline --author="ServerPilot Bot"

# 如果发现问题，可以：
git revert {commit-sha}
# 或
git reset --soft HEAD~1
```

### 4. 监控日志

定期检查：
- `autorun.log` - 发现卡死或异常
- `test.log` - 测试失败原因
- `AUTORUN_STATE.md` - 成功率统计

---

## 故障排查

### 分析阶段一直失败

**现象**：
```
[ERROR] AI 分析失败 (退出码: 1)
```

**可能原因**：
1. Claude Code 未认证
2. 产品方案文档缺失
3. Prompt 格式导致 AI 输出不符合预期

**解决方法**：
```bash
# 检查认证
claude auth status

# 检查文档
ls -lh docs/产品方案-目录.md docs/SERVERPILOT技术方案.md

# 手动测试 Prompt
echo "测试内容" | claude -p
```

### 执行阶段超时

**现象**：
```
[ERROR] 执行超时 (30分钟)，强制终止...
```

**可能原因**：
1. 任务粒度太大
2. AI 陷入循环思考
3. 网络问题导致 API 卡顿

**解决方法**：
- 拆分任务为更小的步骤
- 增加超时时间（修改 `EXECUTE_TIMEOUT`）
- 检查网络连接

### 测试一直失败

**现象**：
```
[ERROR] 测试失败
```

**可能原因**：
1. AI 生成的代码有 bug
2. 测试环境问题
3. 依赖缺失

**解决方法**：
```bash
# 手动运行测试查看详情
pnpm test

# 查看测试日志
cat test.log

# 如需跳过当前任务，手动修改 CURRENT_TASK.md
```

### Git 提交失败

**现象**：
```
[ERROR] Git commit failed
```

**可能原因**：
1. Git 未初始化
2. 没有配置 user.name / user.email
3. 分支冲突

**解决方法**：
```bash
# 初始化仓库
git init
git config user.name "ServerPilot Bot"
git config user.email "bot@serverpilot.dev"

# 检查状态
git status
```

---

## 性能优化建议

### 1. 使用精简的产品方案

- ✅ 使用 `docs/产品方案-目录.md`（精简版）作为主要参考
- ⚠️ 完整的 `docs/DevOps产品方案.md` 仅在需要时查阅
- 减少 AI 读取的 Token 数量，提高响应速度

### 2. 缓存机制（待实现）

```bash
# 未来可考虑：
- 缓存环境信息（避免每次重新探测）
- 缓存知识库向量（避免重复加载）
- 缓存 AI 响应（相似任务复用）
```

### 3. 并行执行（待实现）

```bash
# 当前是串行执行，未来可改为：
- 多个任务并行开发（不同模块）
- 测试与下一轮分析并行
```

---

## 开发历史

### v1.0 - 初始版本 (2026-02-09)

**功能**：
- ✅ AI 自动分析项目
- ✅ AI 自动生成任务
- ✅ AI 自动实现功能
- ✅ 自动运行测试
- ✅ 自动修复测试失败
- ✅ 循环执行
- ✅ 超时和重试机制
- ✅ 状态记录

**成果**：
- 完成 3 轮自动开发
- 成功率：100%（3/3）
- 实现功能：用户认证、Server 启动、Dashboard、定时任务、Docker 部署、文档抓取

### v1.1 - Git 集成版 (2026-02-10)

**新增功能**：
- ✅ 自动 Git 提交
- ✅ 分支管理（feat/autorun-dev-{date}）
- ✅ 标准化 Commit Message
- ✅ 开发文档（本文档）

**改进**：
- 更好的错误处理
- 更详细的日志输出
- 开发文档完善

---

## 未来规划

### 短期（v1.2）

- [ ] 支持远程 Git 推送
- [ ] Web 监控界面（实时查看进度）
- [ ] Slack/钉钉通知集成
- [ ] 任务优先级动态调整

### 中期（v1.3）

- [ ] 多 AI Provider 支持（OpenAI、DeepSeek）
- [ ] 任务并行执行
- [ ] 增量测试（只测试变更部分）
- [ ] 性能指标统计

### 长期（v2.0）

- [ ] 跨项目迁移学习
- [ ] AI 自主选择 AI 模型
- [ ] 代码审查和重构建议
- [ ] 自动生成技术文档

---

## 贡献指南

如果你想改进 `autorun.sh`，请：

1. Fork 项目
2. 创建功能分支：`git checkout -b feat/improve-autorun`
3. 测试你的改动：`./scripts/autorun.sh`（至少运行 3 轮）
4. 更新本文档（如果有架构变化）
5. 提交 Pull Request

---

## 参考资料

- [开发标准](./开发标准.md) - Git 工作流、代码规范
- [产品方案目录](./产品方案-目录.md) - MVP 范围和优先级
- [技术方案](./SERVERPILOT技术方案.md) - 详细技术设计
- [Claude Code 文档](https://claude.ai/code) - CLI 使用方法

---

**最后更新**：2026-02-10
**维护者**：ServerPilot Team
