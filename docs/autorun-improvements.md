# autorun.sh 改进建议

> 基于当前功能的完善方向

---

## 🔥 高优先级（建议立即完善）

### 1. ✅ 完成任务队列集成（当前进行中）

**状态**: 50% 完成

**待完成**:
- [ ] 添加批量生成任务的 Prompt
- [ ] 修改主循环逻辑
- [ ] 集成任务队列检查
- [ ] 测试完整流程

**预期收益**: Token 节省 90%

---

### 2. 💰 Token 使用统计和成本控制

**问题**:
- 不知道消耗了多少 Token
- 无法控制成本
- 可能意外产生高额费用

**解决方案**:
```bash
# 新增变量
TOTAL_TOKENS=0
MAX_TOKENS=1000000        # 最大 Token 限制
COST_PER_1K_TOKENS=0.003  # Claude 定价

# 每次 AI 调用后统计
log_token_usage() {
    local tokens_used="$1"
    TOTAL_TOKENS=$((TOTAL_TOKENS + tokens_used))
    local cost=$(echo "scale=2; $TOTAL_TOKENS * $COST_PER_1K_TOKENS / 1000" | bc)
    log_info "Token 使用: $tokens_used | 总计: $TOTAL_TOKENS | 成本: \$$cost"

    # 检查是否超限
    if [ $TOTAL_TOKENS -gt $MAX_TOKENS ]; then
        log_error "达到 Token 限制 ($MAX_TOKENS)，停止执行"
        exit 1
    fi
}
```

**文件**: 新增 `TOKEN_USAGE.log`

---

### 3. 📊 增量测试（智能测试）

**问题**: 每次都运行全量测试，浪费时间

**解决方案**:
```bash
run_incremental_tests() {
    # 检测变更的文件
    local changed_files=$(git diff --name-only HEAD~1)

    # 只测试相关模块
    if echo "$changed_files" | grep -q "packages/server"; then
        pnpm test:server
    fi

    if echo "$changed_files" | grep -q "packages/agent"; then
        pnpm test:agent
    fi

    # 如果是核心模块，跑全量测试
    if echo "$changed_files" | grep -q "packages/shared"; then
        pnpm test
    fi
}
```

**预期收益**: 测试时间减少 70%

---

### 4. 🔔 任务完成通知（可选通知渠道）

**问题**: 需要手动查看日志才知道进度

**解决方案**:
```bash
# 配置
NOTIFY_METHOD="none"  # none, email, slack, dingtalk, webhook

send_notification() {
    local title="$1"
    local message="$2"

    case "$NOTIFY_METHOD" in
        email)
            echo "$message" | mail -s "$title" "$NOTIFY_EMAIL"
            ;;
        slack)
            curl -X POST "$SLACK_WEBHOOK_URL" \
                -d "{\"text\":\"$title\n$message\"}"
            ;;
        dingtalk)
            curl -X POST "$DINGTALK_WEBHOOK_URL" \
                -H 'Content-Type: application/json' \
                -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"$title\n$message\"}}"
            ;;
        webhook)
            curl -X POST "$CUSTOM_WEBHOOK_URL" \
                -H 'Content-Type: application/json' \
                -d "{\"title\":\"$title\",\"message\":\"$message\"}"
            ;;
    esac
}

# 使用
send_notification "✅ 任务完成" "task-001: 实现用户认证"
send_notification "❌ 任务失败" "task-002: 测试未通过"
```

**文件**: 新增 `notification-config.sh`

---

### 5. 🛡️ 更智能的错误恢复

**问题**:
- Claude 卡死时只能强制终止
- 网络问题导致的失败没有区分
- 重试策略不够智能

**解决方案**:
```bash
# 错误分类
classify_error() {
    local error_output="$1"

    if echo "$error_output" | grep -q "network\|timeout\|connection"; then
        echo "network"  # 网络问题 → 重试
    elif echo "$error_output" | grep -q "rate limit"; then
        echo "rate_limit"  # API 限流 → 等待更长时间
    elif echo "$error_output" | grep -q "authentication"; then
        echo "auth"  # 认证问题 → 需要人工介入
    else
        echo "unknown"
    fi
}

# 智能重试
smart_retry() {
    local error_type=$(classify_error "$1")

    case "$error_type" in
        network)
            log_warning "网络问题，等待 60 秒后重试..."
            sleep 60
            return 0  # 可以重试
            ;;
        rate_limit)
            log_warning "API 限流，等待 5 分钟..."
            sleep 300
            return 0
            ;;
        auth)
            log_error "认证失败，需要人工检查"
            return 1  # 不重试
            ;;
        *)
            sleep 30
            return 0
            ;;
    esac
}
```

---

## 🌟 中优先级（有时间可以做）

### 6. 📝 任务依赖管理

**场景**: task-002 依赖 task-001 完成

**解决方案**:
```markdown
### [pending] 实现数据库连接

**ID**: task-001
**依赖**: 无
...

### [pending] 实现用户认证

**ID**: task-002
**依赖**: task-001  # 必须先完成数据库连接
...
```

**代码**:
```bash
check_dependencies() {
    local task_id="$1"
    local deps=$(grep -A 10 "^### \[pending\].*$task_id" "$TASK_QUEUE" | grep "依赖:" | cut -d: -f2)

    # 检查依赖任务是否都完成
    for dep in $deps; do
        if ! grep -q "\[completed\].*$dep" "$TASK_QUEUE"; then
            return 1  # 依赖未完成
        fi
    done

    return 0  # 所有依赖都完成
}
```

---

### 7. 🔍 代码质量检查（AI Code Review）

**在提交前自动审查代码**:
```bash
run_code_review() {
    local changed_files=$(git diff --name-only HEAD)

    log_info "🔍 AI 代码审查中..."

    local review_prompt="请审查以下代码变更，检查：
1. 代码规范是否符合 docs/开发标准.md
2. 是否有潜在的 Bug
3. 是否有安全漏洞
4. 是否有性能问题
5. 测试覆盖是否充分

变更文件：
$(git diff HEAD)

请给出审查意见和改进建议。"

    echo "$review_prompt" | claude -p > /tmp/code_review.txt

    # 检查是否有严重问题
    if grep -q "严重问题\|critical\|security issue" /tmp/code_review.txt; then
        log_error "代码审查发现严重问题！"
        cat /tmp/code_review.txt
        return 1
    fi

    log_success "代码审查通过"
    return 0
}
```

---

### 8. 🎯 多 AI 模型支持

**根据任务类型选择最合适的模型**:
```bash
# 配置
AI_MODEL_ANALYZE="claude-opus-4"      # 分析用大模型
AI_MODEL_EXECUTE="claude-sonnet-3-5"  # 执行用中模型
AI_MODEL_FIX="claude-haiku-3"         # 修复用小模型

run_claude_with_model() {
    local model="$1"
    local prompt="$2"

    echo "$prompt" | claude -p --model "$model"
}

# 使用
run_claude_with_model "$AI_MODEL_ANALYZE" "$analyze_prompt"
run_claude_with_model "$AI_MODEL_EXECUTE" "$execute_prompt"
```

**预期收益**: 成本降低 50%

---

### 9. 📦 定期备份和回滚点

**自动创建回滚点**:
```bash
create_checkpoint() {
    local checkpoint_name="checkpoint-$(date +%Y%m%d-%H%M%S)"

    # Git 快照
    git tag "$checkpoint_name"

    # 备份数据库
    cp data/*.db "backups/$checkpoint_name.db"

    log_success "创建检查点: $checkpoint_name"
}

# 每完成 5 个任务创建一个检查点
if [ $((completed % 5)) -eq 0 ]; then
    create_checkpoint
fi
```

---

### 10. 🖥️ Web 监控界面（可选）

**实时查看进度**:

创建简单的 Web 服务：
```bash
# scripts/web-monitor.sh
python3 -m http.server 8080 &

# 生成 HTML
cat > monitor.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>AutoRun Monitor</title>
    <meta http-equiv="refresh" content="5">
</head>
<body>
    <h1>AutoRun 监控</h1>
    <pre id="log"></pre>
    <script>
        fetch('/autorun.log')
            .then(r => r.text())
            .then(t => document.getElementById('log').textContent = t);
    </script>
</body>
</html>
EOF
```

访问：`http://localhost:8080/monitor.html`

---

## 🚀 低优先级（未来可能需要）

### 11. 并行任务执行

**场景**: task-001 和 task-002 互不依赖，可以并行

**复杂度**: 高，需要处理资源竞争

---

### 12. 学习和优化

**记录成功模式，优化 Prompt**

---

### 13. 资源监控

**监控 CPU、内存、磁盘**

---

### 14. 配置文件化

**创建 `autorun.config.sh`**

---

## 📊 优先级总结

| 功能 | 优先级 | 预期收益 | 复杂度 | 推荐 |
|------|--------|---------|--------|------|
| 1. 完成任务队列 | 🔥🔥🔥 | Token -90% | 中 | ⭐⭐⭐⭐⭐ |
| 2. Token 统计 | 🔥🔥🔥 | 成本可控 | 低 | ⭐⭐⭐⭐⭐ |
| 3. 增量测试 | 🔥🔥 | 时间 -70% | 中 | ⭐⭐⭐⭐ |
| 4. 通知机制 | 🔥🔥 | 体验提升 | 低 | ⭐⭐⭐⭐ |
| 5. 智能错误恢复 | 🔥🔥 | 稳定性 | 中 | ⭐⭐⭐⭐ |
| 6. 任务依赖 | 🔥 | 正确性 | 中 | ⭐⭐⭐ |
| 7. 代码审查 | 🔥 | 质量提升 | 低 | ⭐⭐⭐ |
| 8. 多模型支持 | 🔥 | 成本 -50% | 低 | ⭐⭐⭐ |
| 9. 备份回滚 | 🔥 | 安全性 | 低 | ⭐⭐⭐ |
| 10. Web 监控 | - | 可选 | 中 | ⭐⭐ |

---

## 🎯 建议实施顺序

### 第一阶段（本次）
1. ✅ 完成任务队列集成
2. ✅ 添加 Token 统计
3. ✅ 添加通知机制（可选配置）

### 第二阶段（下次）
4. 增量测试
5. 智能错误恢复
6. 代码审查

### 第三阶段（未来）
7. 多模型支持
8. 任务依赖管理
9. 其他优化

---

**建议**: 先完成第一阶段的3个功能，这些都是高价值、低复杂度的改进。
