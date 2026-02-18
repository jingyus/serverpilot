# AI 自循环开发脚本 — 使用手册

## 一、简介

`autorun.sh` 是 ServerPilot 项目的 **AI 自动化开发引擎**。它通过调用 Claude Code CLI，实现"分析项目 → 生成任务 → 编写代码 → 运行测试 → Git 提交"的全自动循环，无需人工干预即可持续推进项目开发。

配套脚本 `task-queue-helper.sh` 负责任务队列的读写管理，所有状态数据持久化在 `TASK_QUEUE.md` 中。

### 核心特点

- **全自动闭环**：AI 自动读产品方案 → 判断优先级 → 写代码 → 跑测试 → 提交 Git
- **批量任务队列**：一次性生成 5-10 个任务，按优先级逐个执行
- **三层失败防御**：单轮重试 + 跨轮追踪 + 手动重置，避免同一任务无限循环
- **单文件状态**：所有任务状态（含失败计数）内嵌在 `TASK_QUEUE.md`，脚本重启不丢数据
- **Token 成本控制**：实时估算 Token 用量，超限自动停止
- **跨平台兼容**：使用 awk 替代 sed，兼容 macOS (BSD) 和 Linux (GNU)

---

## 二、文件结构

```
scripts/
├── autorun.sh              # 主脚本 — AI 自循环开发引擎
├── task-queue-helper.sh    # 辅助脚本 — 任务队列读写函数库
├── send-notification.py    # 可选 — 邮件通知脚本
└── autorun用法.md           # 本文档

项目根目录/
├── TASK_QUEUE.md           # 任务队列（唯一数据源）
├── CURRENT_TASK.md         # 当前正在执行的任务内容
├── AUTORUN_STATE.md        # 每轮执行的历史日志
├── autorun.log             # 运行时日志
├── TOKEN_USAGE.log         # Token 使用统计
└── test.log                # 测试输出日志
```

---

## 三、使用方法

### 前置要求

- Node.js 22+、pnpm
- [Claude Code CLI](https://claude.ai/code) 已安装并认证
- 项目产品方案文档存在：`docs/产品方案-目录.md`、`docs/开发标准.md`

### 基本用法

```bash
# 启动自循环开发（前台运行）
./scripts/autorun.sh

# 后台运行（推荐长时间跑）
nohup ./scripts/autorun.sh > /dev/null 2>&1 &

# 按 Ctrl+C 随时停止
```

### 命令行参数

```bash
# 查看帮助
./scripts/autorun.sh --help

# 查看失败任务统计
./scripts/autorun.sh --show-failures

# 强制重置所有失败任务（清零失败次数，改回 pending）
./scripts/autorun.sh --reset-failures
```

### 双模型与可选配置

autorun 采用「布置任务用强模型、执行开发用性价比模型」的策略，以兼顾任务规划质量与成本：

| 阶段     | 默认模型 | 说明 |
|----------|----------|------|
| 布置任务（discover） | opus   | 理解文档、拆解任务、排优先级，调用频率低 |
| 执行开发（execute） | sonnet | 单任务代码实现，调用次数多，性价比高 |
| 测试修复（fix）     | sonnet | 与执行阶段一致 |

可通过环境变量覆盖（在运行脚本前 export，或在具体 autorun_*.sh 的模块配置处取消注释）：

```bash
export CLAUDE_MODEL_DISCOVER=opus   # 布置任务时使用的模型
export CLAUDE_MODEL_EXECUTE=sonnet  # 执行开发时使用的模型
export CLAUDE_MODEL_FIX=sonnet     # 测试修复时使用的模型（默认与 EXECUTE 相同）
```

---

## 四、核心设计思路

### 4.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    autorun.sh 主循环                      │
│                                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │ 1.检查任务队列 │───→│ 2.获取下一任务 │───→│ 3.AI 执行任务│  │
│  │  (生成/重试)  │    │  (跳过超限)  │    │  (带重试)   │  │
│  └─────────────┘    └─────────────┘    └──────┬──────┘  │
│                                               │         │
│  ┌─────────────┐    ┌─────────────┐    ┌──────▼──────┐  │
│  │ 6.等待间隔   │◄───│ 5.Git 提交   │◄───│ 4.增量测试  │  │
│  │  (30秒)     │    │  (自动推送)  │    │  (智能检测)  │  │
│  └──────┬──────┘    └─────────────┘    └─────────────┘  │
│         │                                               │
│         └───────────────── 循环 ◄────────────────────────│
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │   TASK_QUEUE.md     │
              │  (唯一数据源)        │
              │  任务状态 + 失败计数  │
              └─────────────────────┘
```

### 4.2 任务生命周期

```
[pending] ──→ [in_progress] ──→ [completed] ✅
                    │
                    ▼ (失败)
               [failed]
                    │
              ┌─────┴─────┐
              ▼           ▼
         失败次数<上限  失败次数≥上限
              │           │
              ▼           ▼
         [pending]     永久跳过
         (自动重试)   (需手动 --reset-failures)
```

### 4.3 三层失败防御机制

这是本脚本最核心的设计，防止同一个有问题的任务无限消耗 Token：

| 层级 | 机制 | 配置 | 说明 |
|------|------|------|------|
| **第 1 层** | 单轮重试 | `MAX_RETRIES=3` | 同一轮内，执行失败最多重试 3 次，带智能退避（网络 60s、限流 300s） |
| **第 2 层** | 跨轮追踪 | `MAX_TASK_FAILURES=3` | 同一任务跨多轮累计失败 3 次后自动标记为 `[failed]` 并跳过 |
| **第 3 层** | 手动重置 | `--reset-failures` | 所有 `[failed]` 任务强制改回 `[pending]`，失败次数清零 |

**失败数据持久化**：失败次数和失败原因直接写入 `TASK_QUEUE.md` 的任务块中：

```markdown
### [failed] 某个任务

**ID**: task-001
**失败次数**: 2
**失败原因**: 执行阶段尝试 3 次
**失败时间**: 2026-02-11 08:00:00
```

这样即使脚本重启、任务队列重新生成，失败信息也不会丢失。

### 4.4 任务队列管理策略

```
check_and_generate_tasks() 的决策逻辑：

1. 有 pending 或 in_progress 任务？ → 继续执行
2. 只剩 failed 任务？
   2a. 有可重试的（失败次数 < 上限）？ → 自动改回 pending
   2b. 全部超限？ → 跳过，生成新任务
3. 队列为空？ → 调用 AI 批量生成 5-10 个新任务
```

### 4.5 智能错误分类与重试

脚本会分析错误输出，针对不同类型采取不同策略：

| 错误类型 | 判定关键词 | 重试策略 |
|----------|-----------|---------|
| 网络问题 | `timeout`, `ECONNREFUSED` | 等待 60s/120s/180s 后重试 |
| API 限流 | `rate limit`, `429` | 等待 5min/10min/15min 后重试 |
| 认证失败 | `unauthorized`, `401` | **不重试**，需人工介入 |
| 内存不足 | `out of memory` | **不重试**，需人工处理 |
| 磁盘满 | `ENOSPC` | **不重试**，需人工清理 |
| 未知错误 | 其他 | 等待 30s 后重试 |

### 4.6 Token 成本控制

- 基于字符数估算 Token 量（中英混合约 2.2 字符/token）
- 考虑 Claude Code CLI 自动添加的上下文（约 4 倍乘数）
- 达到 80% 时警告，达到 100%（默认 1000 万 token）自动停止
- 所有用量记录到 `TOKEN_USAGE.log`

### 4.7 增量测试

不是每次都跑全量测试，而是智能检测变更模块：

- `packages/server/` 变更 → 只测 server
- `packages/dashboard/` 变更 → 只测 dashboard
- `packages/shared/` 变更 → 全量测试（共享模块影响所有包）
- 无文件变更 → 跳过测试

---

## 五、配置参数一览

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `INTERVAL` | 30 | 每轮循环间隔（秒） |
| `MAX_ITERATIONS` | 1000 | 最大循环次数 |
| `ANALYZE_TIMEOUT` | 3600 | 分析阶段超时（秒） |
| `EXECUTE_TIMEOUT` | 3600 | 执行阶段超时（秒） |
| `MAX_RETRIES` | 3 | 单轮最大重试次数 |
| `MAX_TASK_FAILURES` | 3 | 跨轮最大失败次数 |
| `BATCH_SIZE` | 5 | 每次生成任务数量 |
| `MAX_TOKENS` | 10000000 | Token 使用上限 |
| `ENABLE_NOTIFICATION` | true | 是否启用邮件通知 |

修改方式：直接编辑 `autorun.sh` 顶部的配置区域。

---

## 六、task-queue-helper.sh 函数参考

### 任务查询

| 函数 | 参数 | 说明 |
|------|------|------|
| `get_task_stats` | `queue_file` | 返回 `"总数 待完成 进行中 已完成 失败"` |
| `get_next_task` | `queue_file`, `max_failures` | 获取下一个 pending 任务，自动跳过超限的 |
| `get_failure_count` | `task_id`, `queue_file` | 从任务块读取失败次数 |
| `count_retryable_failed_tasks` | `queue_file`, `max_failures` | 统计可重试的失败任务数 |

### 状态变更

| 函数 | 参数 | 说明 |
|------|------|------|
| `mark_task_in_progress` | `queue_file`, `task_id` | 按 ID 精确标记为 `[in_progress]` |
| `mark_task_completed` | `queue_file`, `task_id` | 标记为 `[completed]`，写入完成时间 |
| `mark_task_failed` | `queue_file`, `task_id`, `error_msg` | 标记为 `[failed]`，递增失败次数，记录原因 |

### 失败管理

| 函数 | 参数 | 说明 |
|------|------|------|
| `retry_eligible_failed_tasks` | `queue_file`, `max_failures` | 将未超限的 `[failed]` 改回 `[pending]` |
| `reset_failed_tasks` | `queue_file` | 强制重置所有失败任务，清零失败次数 |
| `show_failure_summary` | `queue_file` | 打印失败任务统计 |

### 设计原则

- **TASK_QUEUE.md 是唯一数据源**：不依赖外部状态文件
- **awk 替代 sed**：兼容 macOS BSD sed 和 Linux GNU sed
- **process substitution**：`while read ... done < <(grep ...)` 兼容 bash/zsh

---

## 七、日常运维

### 查看运行状态

```bash
# 查看实时日志
tail -f autorun.log

# 查看任务队列
cat TASK_QUEUE.md

# 查看历史记录
cat AUTORUN_STATE.md

# 查看 Token 消耗
cat TOKEN_USAGE.log
```

### 处理失败任务

```bash
# 查看哪些任务失败了
./scripts/autorun.sh --show-failures

# 全部重置重试
./scripts/autorun.sh --reset-failures

# 手动编辑某个任务：将 [failed] 改为 [pending]，将 **失败次数** 改为 0
vi TASK_QUEUE.md
```

### 手动添加任务

直接编辑 `TASK_QUEUE.md`，在 `## 任务列表` 下添加：

```markdown
### [pending] 你的任务标题

**ID**: task-custom-001
**优先级**: P0
**模块路径**: packages/server/src/
**任务描述**: 详细描述
**产品需求**: 对应需求
**验收标准**: 验收条件
**创建时间**: 2026-02-11 12:00:00
**完成时间**: -

---
```

### macOS 长时间运行注意事项

脚本会自动调用 `caffeinate` 防止系统休眠。如果后台运行：

```bash
# 推荐方式
nohup ./scripts/autorun.sh > /dev/null 2>&1 &

# 查看是否在运行
ps aux | grep autorun.sh

# 停止
kill $(pgrep -f autorun.sh)
```

---

## 八、常见问题

**Q: 任务一直失败怎么办？**
A: 先用 `--show-failures` 查看失败原因。如果是代码逻辑问题，建议手动修复后再让 AI 继续；如果是网络/API 问题，等恢复后用 `--reset-failures` 重试。

**Q: TASK_QUEUE.md 被清空了怎么办？**
A: 脚本会在队列为空时自动调用 AI 批量生成新任务。失败计数内嵌在任务块中，只要任务块还在就不会丢失。

**Q: Token 用量超限了？**
A: 修改 `autorun.sh` 中的 `MAX_TOKENS` 值，或查看 `TOKEN_USAGE.log` 分析哪些步骤消耗最大。

**Q: 脚本重启后还能继续吗？**
A: 可以。所有状态都在 `TASK_QUEUE.md` 中，脚本启动时会自动读取队列继续执行。`[in_progress]` 状态的任务会被重新获取。
