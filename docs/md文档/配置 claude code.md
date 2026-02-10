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