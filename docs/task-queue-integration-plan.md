# 任务队列集成方案

> 优化 autorun.sh，减少 Token 消耗

---

## 当前问题

- ❌ 每轮都重新分析和生成任务
- ❌ 重复读取大量文档（产品方案、开发标准）
- ❌ 浪费 Token 和时间
- ❌ 任务进度不可视化

---

## 解决方案

### 核心思路

```
旧流程（每轮）:
  读取文档 → AI 分析 → 生成1个任务 → 执行 → 测试 → 循环

新流程:
  首次: 读取文档 → AI 分析 → 批量生成5-10个任务 → 存入队列
  后续: 从队列取任务 → 执行 → 测试 → 标记完成 → 取下一个
  队列空: 重新批量生成任务
```

### Token 节省估算

| 阶段 | 旧方式 | 新方式 | 节省 |
|------|--------|--------|------|
| 10个任务 | 10次分析×5000 tokens = 50,000 tokens | 1次分析×5000 tokens = 5,000 tokens | **90%** |
| 时间 | 10×10分钟 = 100分钟 | 10分钟 + 10×20分钟 = 210分钟（但连续执行） | 更高效 |

---

## 新增文件

### 1. TASK_QUEUE.md - 任务队列主文件

```markdown
# ServerPilot 任务队列

## 📊 统计信息
- 总任务数: 10
- 待完成: 5
- 进行中: 1
- 已完成: 3
- 失败: 1

## 📋 任务列表

### [pending] 实现用户认证服务
**ID**: task-001
**优先级**: P0
**模块路径**: packages/server/src/auth/
...

### [completed] 配置数据库连接
**ID**: task-002
**优先级**: P0
...
```

### 2. scripts/task-queue-helper.sh - 辅助函数

提供任务队列操作函数：
- `get_task_stats()` - 统计任务
- `get_next_task()` - 获取下一个任务
- `mark_task_*()` - 更新任务状态
- `add_tasks_to_queue()` - 添加任务

---

## autorun.sh 核心修改

### 1. 新增变量

```bash
TASK_QUEUE="$PROJECT_DIR/TASK_QUEUE.md"  # 任务队列
BATCH_SIZE=5                              # 批量生成数量
```

### 2. 新增函数

```bash
# 批量生成任务
run_claude_batch_generate() {
    # 调用 AI 批量分析并生成 5-10 个任务
    # 将任务添加到 TASK_QUEUE.md
}

# 检查并生成任务
check_and_generate_tasks() {
    local stats=$(get_task_stats "$TASK_QUEUE")
    read total pending in_progress completed failed <<< "$stats"

    if [ "$pending" -eq 0 ] && [ "$in_progress" -eq 0 ]; then
        log_info "任务队列为空，开始批量生成任务..."
        run_claude_batch_generate
    else
        log_info "任务队列状态: 待处理 $pending | 进行中 $in_progress | 已完成 $completed"
    fi
}
```

### 3. 修改主循环

```bash
# 旧逻辑
while [ $iteration -lt $MAX_ITERATIONS ]; do
    # 每次都分析生成任务
    run_claude_analyze $iteration
    run_claude_execute $iteration
    ...
done

# 新逻辑
while [ $iteration -lt $MAX_ITERATIONS ]; do
    # 检查任务队列
    check_and_generate_tasks

    # 获取下一个任务
    task_content=$(get_next_task "$TASK_QUEUE")

    if [ -n "$task_content" ]; then
        # 标记为进行中
        mark_task_in_progress "$TASK_QUEUE"

        # 执行任务
        echo "$task_content" > "$TASK_FILE"
        run_claude_execute $iteration

        # 运行测试
        if run_tests; then
            mark_task_completed "$TASK_QUEUE"
        else
            mark_task_failed "$TASK_QUEUE" "测试失败"
        fi
    fi

    sleep $INTERVAL
done
```

---

## 新工作流程

### 第一轮（队列为空）

```
1. check_and_generate_tasks()
   → 检测队列为空
   → 调用 run_claude_batch_generate()
   → AI 分析项目，生成 5-10 个任务
   → 写入 TASK_QUEUE.md

2. get_next_task()
   → 从队列获取第一个 [pending] 任务
   → 标记为 [in_progress]

3. run_claude_execute()
   → AI 执行任务（不需要重新分析）

4. run_tests()
   → 测试通过 → mark_task_completed()
   → 测试失败 → mark_task_failed()
```

### 第二轮及后续（队列有任务）

```
1. check_and_generate_tasks()
   → 检测队列有 pending 任务
   → 跳过生成，显示统计信息

2. get_next_task()
   → 获取下一个任务
   → 标记为 in_progress

3-4. 执行和测试（同上）
```

### 队列清空后

```
1. check_and_generate_tasks()
   → 检测队列为空
   → 重新批量生成任务

2. 继续循环...
```

---

## 任务队列格式

### 批量生成 Prompt 输出格式

```markdown
### [pending] 任务标题

**ID**: task-001
**优先级**: P0
**模块路径**: packages/server/src/
**任务描述**: 详细说明
**产品需求**: 对应功能点
**验收标准**: 如何验证
**创建时间**: 2026-02-10 23:00:00
**完成时间**: -

---

### [pending] 下一个任务

**ID**: task-002
...
```

### 任务状态转换

```
[pending] → [in_progress] → [completed]
                ↓
            [failed]
```

---

## 用户交互

### 查看任务队列

```bash
cat TASK_QUEUE.md
```

### 手动添加任务

直接编辑 `TASK_QUEUE.md`，添加：

```markdown
### [pending] 自定义任务

**ID**: task-custom-001
**优先级**: P0
...
```

### 重置失败任务

将 `[failed]` 改为 `[pending]`

### 清空队列重新生成

```bash
# 备份现有队列
mv TASK_QUEUE.md TASK_QUEUE.backup.md

# 重新初始化
echo "# ServerPilot 任务队列..." > TASK_QUEUE.md

# 重新运行 autorun.sh，会自动生成新任务
```

---

## 优势总结

### Token 节省
- ✅ 减少 90% 的文档读取
- ✅ 只在队列为空时才分析
- ✅ 批量生成效率更高

### 可视化
- ✅ 实时查看任务进度
- ✅ 统计信息一目了然
- ✅ 失败任务可追溯

### 灵活性
- ✅ 支持手动添加任务
- ✅ 支持调整任务优先级
- ✅ 支持重试失败任务

### 可靠性
- ✅ 任务状态持久化
- ✅ 中断后可恢复
- ✅ 完整的历史记录

---

## 兼容性

- ✅ 保留所有现有功能
- ✅ 保留原有日志格式
- ✅ 保留 Git 自动提交
- ✅ 保留重试机制
- ✅ 向下兼容（可回退到旧版本）

---

## 实施步骤

1. ✅ 创建 TASK_QUEUE.md
2. ✅ 创建 task-queue-helper.sh
3. ⏳ 修改 autorun.sh 主循环
4. ⏳ 添加批量生成 Prompt
5. ⏳ 测试新流程
6. ⏳ 提交并推送

---

**建议**: 先备份当前的 autorun.sh，然后逐步集成新功能。
