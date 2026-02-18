| 通义千问Max（不支持思考模式）   | qwen3-max、qwen3-max-2025-09-23、qwen3-max-preview [查看更多](https://help.aliyun.com/zh/model-studio/models#d4ccf72f23jh9) |
| ------------------------------- | ------------------------------------------------------------ |
| 通义千问Plus                    | qwen-plus、qwen-plus-latest、qwen-plus-2025-09-11 [查看更多](https://help.aliyun.com/zh/model-studio/models#5ef284d4ed42p) |
| 通义千问Flash                   | qwen-flash、qwen-flash-2025-07-28 [查看更多](https://help.aliyun.com/zh/model-studio/models#13ff05e329blt) |
| 通义千问Turbo                   | qwen-turbo、qwen-turbo-latest [查看更多](https://help.aliyun.com/zh/model-studio/models#947fc66bc1ldf) |
| 通义千问Coder（不支持思考模式） | qwen3-coder-plus、qwen3-coder-plus-2025-09-23、qwen3-coder-flash [查看更多](https://help.aliyun.com/zh/model-studio/models#d698550551bob) |



设置 claudecode deepseek

export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic

export ANTHROPIC_AUTH_TOKEN=sk-2f0c79e54b8a437889ccc13e0a8ba616

export API_TIMEOUT_MS=600000

export ANTHROPIC_MODEL=deepseek-chat

export ANTHROPIC_SMALL_FAST_MODEL=deepseek-chat

export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1



阿里的配置

export ANTHROPIC_BASE_URL=https://dashscope.aliyuncs.com/apps/anthropic

export ANTHROPIC_AUTH_TOKEN=sk-2e29f3ec55a6485993a1073dc012c1bc

export ANTHROPIC_MODEL=qwen3-coder-plus

export ANTHROPIC_SMALL_FAST_MODEL=qwen3-coder-plus



1. ```bash
   vim ~/.zshrc
   ```



1. ```bash
   source ~/.zshrc
   ```

2. 

---

## 故障排查：模型报错 "may not exist or you may not have access"

### 原因说明

Claude Code 会按以下优先级决定把请求发到哪里、用哪个模型：

1. **ANTHROPIC_BASE_URL**：若已设置，所有请求会发到该地址（可以是本地代理/Claude Code Router、DeepSeek、阿里等）。
2. **模型 ID**：界面里 `/model` 选的 `haiku` 会解析为 `claude-haiku-4-5-20251001`。若请求发到**第三方代理**，代理可能只支持自己的模型名（如 `deepseek-chat`、`qwen3-coder-plus`），不认识 `claude-haiku-4-5-20251001`，就会报「模型不存在或无权访问」。
3. **ANTHROPIC_AUTH_TOKEN**：若为占位值（如 `test`）或空，上游 API 会返回未授权，也可能被报成「模型不可用」。

### 修复步骤（三选一）

**方案 A：直连官方 Anthropic（推荐先试）**

- 关闭本地 Claude Code Router / 代理，让 Claude Code 直连 Anthropic。
- 在终端执行（或写进 `~/.zshrc` 后 `source ~/.zshrc`）：

```bash
# 取消代理，直连官方
unset ANTHROPIC_BASE_URL
# 使用你的 Anthropic API Key（以 sk-ant- 开头）
export ANTHROPIC_AUTH_TOKEN="sk-ant-你的真实Key"
# 可选：指定模型别名，不设则用界面选的
export ANTHROPIC_MODEL="haiku"
```

- 重启 Claude Code，再试 `/model` 选 haiku。若仍有报错，检查 [Anthropic 控制台](https://console.anthropic.com/) 的 API Key 是否有效、是否有该模型权限。

**方案 B：使用 DeepSeek 代理**

- 必须把**模型**设为 DeepSeek 支持的名称，不能再用 `claude-haiku-4-5-20251001`：

```bash
export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
export ANTHROPIC_AUTH_TOKEN="你的DeepSeek_API_Key"
export ANTHROPIC_MODEL=deepseek-chat
export ANTHROPIC_SMALL_FAST_MODEL=deepseek-chat
export ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-chat
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```

- 在 Claude Code 里用 `/model` 时，若可选列表里没有 `deepseek-chat`，可设置环境变量后重启，或选「default」让 `ANTHROPIC_MODEL` 生效。

**方案 C：使用本地 Claude Code Router（127.0.0.1:3456）**

- 当前你本机有 `ANTHROPIC_BASE_URL=http://127.0.0.1:3456`，说明请求被转到本地代理。
- 若 Router 会把「haiku」映射到某个具体上游模型，需要保证：
  1. **ANTHROPIC_AUTH_TOKEN** 为 Router 认可的 Key（或你填写的真实 Anthropic/DeepSeek Key，由 Router 转发）。
  2. **ANTHROPIC_MODEL** 设为 Router 支持的模型 ID（向 Router 文档或维护者确认，例如是否要写成 `claude-haiku-4-5` 或别的 ID）。
- 若暂时不用 Router，按**方案 A** 取消 `ANTHROPIC_BASE_URL` 并设置官方 Key 即可。

### 如何确认当前生效配置

在终端执行：

```bash
echo "ANTHROPIC_BASE_URL=$ANTHROPIC_BASE_URL"
echo "ANTHROPIC_MODEL=$ANTHROPIC_MODEL"
env | grep -E '^ANTHROPIC_|^CLAUDE_CODE'
```

- 若 `ANTHROPIC_BASE_URL` 指向 127.0.0.1 或第三方地址，但模型选的是 `claude-haiku-4-5-20251001`，且代理不支持该 ID，就会报错。
- 按上面三选一修正后，**重启 Claude Code** 再试。