# Token 使用统计说明

## ⚠️ 重要提示

**当前 Token 统计是估算值，并非精确统计！**

## 估算方法

### 基础估算公式
```bash
base_tokens = char_count / 2.2
```

- **英文文本**：约 4 字符 = 1 token
- **中文文本**：约 1.5-2 字符 = 1 token
- **代码**：约 2.5-3 字符 = 1 token
- **混合内容**：平均约 2.2 字符 = 1 token

### 上下文倍数（重要！）

**Claude Code CLI 实际使用的 Token 远超我们看到的输入/输出**

实际发送给 Claude API 的内容包括：
1. 🔧 **系统 Prompt**（工具定义、行为指令）：~2000-5000 tokens
2. 📁 **项目上下文**（文件索引、代码片段）：~5000-20000 tokens
3. 💬 **对话历史**（多轮对话的累积）：变化量大
4. ⚙️ **工具调用记录**：每次工具使用增加开销

**因此我们使用 4 倍的上下文倍数**：
```bash
estimated_tokens = base_tokens × 4
```

这个倍数是保守估计，实际可能更高（5-10倍）。

## 准确性评估

| 场景 | 估算准确度 | 说明 |
|------|-----------|------|
| 简单对话 | ±30% | 上下文较少，误差小 |
| 复杂任务 | ±50% | 工具调用多，误差大 |
| 多轮对话 | ±70% | 对话历史累积，误差很大 |

## 如何获取精确统计

### 方法 1: Anthropic 控制台（推荐）

访问 Anthropic 控制台查看实际 Token 使用量：
1. 登录 https://console.anthropic.com/
2. 进入 **Usage** 页面
3. 查看 API 调用详情和实际 Token 计数

### 方法 2: 使用 Anthropic API（需要代码修改）

如果需要精确统计，可以修改脚本直接调用 Anthropic API 而不是 Claude Code CLI：

```bash
# 使用 curl 调用 API 并解析响应中的 usage 字段
response=$(curl -X POST https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "content-type: application/json" \
  -d '{...}')

input_tokens=$(echo "$response" | jq '.usage.input_tokens')
output_tokens=$(echo "$response" | jq '.usage.output_tokens')
```

但这需要：
- 重写 prompt 构建逻辑
- 失去 Claude Code CLI 的便利功能（自动工具调用、项目上下文等）

## 成本估算准确性

由于 Token 估算有误差，**成本估算也仅供参考**。

当前定价（2026-02-11）：
- **输入 Token**：$0.003 / 1K tokens
- **输出 Token**：$0.015 / 1K tokens

**真实成本可能是估算值的 1.5-3 倍！**

### 建议

1. ✅ 使用 `MAX_TOKENS` 限制作为预算上限，但留有余量
2. ✅ 定期检查 Anthropic 控制台确认实际花费
3. ✅ 设置 Anthropic 账户的月度预算上限
4. ⚠️ 不要完全依赖脚本内的成本估算做财务决策

## 改进计划

未来可能的改进方向：

### 短期
- [ ] 添加手动校准因子（用户可根据实际使用调整倍数）
- [ ] 记录每轮的估算误差，动态调整倍数

### 中期
- [ ] 使用 `tiktoken` 或 `anthropic-tokenizer` 库进行更准确的基础估算
- [ ] 解析 Claude Code CLI 的 verbose 输出（如果有）

### 长期
- [ ] 切换到 Anthropic API 直接调用，获取精确 Token 统计
- [ ] 实现本地缓存和上下文优化，减少实际 Token 消耗

## 当前配置

查看和修改 Token 限制：

```bash
# 编辑 scripts/autorun.sh
MAX_TOKENS=10000000  # 默认 1000 万 tokens（约 $150-$300）
```

查看 Token 使用日志：

```bash
cat TOKEN_USAGE.log
```

## 总结

**Token 统计 = 粗略估算 + 4倍上下文 ≈ 实际使用量的 60-80%**

虽然不够精确，但足以：
- ✅ 提供成本量级的概念（几美元 vs 几百美元）
- ✅ 防止意外超支（通过 MAX_TOKENS 限制）
- ✅ 追踪相对使用趋势（哪些任务消耗更多）

如需精确统计，**请查看 Anthropic 控制台**。
