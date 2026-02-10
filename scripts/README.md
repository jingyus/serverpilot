# Scripts 目录

本目录包含 AI Installer 项目的自动化脚本。

## 📋 脚本列表

| 脚本 | 功能 | 用法 |
|------|------|------|
| [run.sh](run.sh) | 🤖 自动化开发主脚本 | `./scripts/run.sh` 或 `./dev.sh start` |
| [stop.sh](stop.sh) | 🛑 停止自动化开发 | `./scripts/stop.sh` 或 `./dev.sh stop` |
| [logs.sh](logs.sh) | 📋 查看实时日志 | `./scripts/logs.sh` 或 `./dev.sh logs` |
| [watch.sh](watch.sh) | 📊 进度监控面板 | `./scripts/watch.sh` 或 `./dev.sh watch` |

## 🚀 快速开始

### 方式1：使用根目录的便捷脚本（推荐）

```bash
# 在项目根目录
./dev.sh start   # 启动自动化开发
./dev.sh logs    # 查看实时日志
./dev.sh watch   # 查看进度监控
./dev.sh stop    # 停止开发
```

### 方式2：直接运行脚本

```bash
# 在项目根目录
./scripts/run.sh    # 启动
./scripts/logs.sh   # 日志
./scripts/watch.sh  # 监控
./scripts/stop.sh   # 停止
```

## 📝 脚本详细说明

### run.sh - 自动化开发主脚本

**功能：**
- 自动读取 TODO.md 中的任务
- 调用 Claude Code 完成开发
- 自动编写测试并验证
- 更新任务状态和开发日志

**特性：**
- ✅ 测试驱动开发（TDD）
- ✅ 增量开发（一次一个任务）
- ✅ 完整日志记录
- ✅ 进度跟踪
- ✅ 智能恢复

**输出：**
- `dev.log` - 开发日志
- `test.log` - 测试日志
- `STATE.md` - 状态更新

### stop.sh - 停止脚本

**功能：**
- 自动查找运行中的 run.sh 进程
- 优雅停止（SIGTERM）
- 必要时强制终止（SIGKILL）

**用法：**
```bash
./scripts/stop.sh
```

### logs.sh - 实时日志查看

**功能：**
- 实时跟踪 dev.log
- 彩色高亮输出
- 显示运行状态

**颜色说明：**
- 🟢 绿色 - SUCCESS
- 🔴 红色 - ERROR
- 🟡 黄色 - WARNING
- 🟣 紫色 - TASK
- 🔵 蓝色 - INFO

**用法：**
```bash
./scripts/logs.sh
# 按 Ctrl+C 退出
```

### watch.sh - 进度监控面板

**功能：**
- 实时显示开发进度
- 统计任务完成情况
- 显示最近完成的任务
- 显示当前任务
- 显示最新日志
- 预计剩余时间

**刷新：**
- 每5秒自动刷新

**用法：**
```bash
./scripts/watch.sh
# 按 Ctrl+C 退出
```

## 🎮 最佳实践

### 双终端模式（推荐）

**终端1** - 实时日志：
```bash
./dev.sh logs
```

**终端2** - 进度监控：
```bash
./dev.sh watch
```

### 后台运行模式

**启动：**
```bash
nohup ./scripts/run.sh > /dev/null 2>&1 &
```

**监控：**
```bash
./dev.sh logs    # 查看日志
./dev.sh watch   # 查看进度
```

**停止：**
```bash
./dev.sh stop
```

## 📊 相关文件

- [PROMPT.md](../PROMPT.md) - AI Agent 工作流程定义
- [TODO.md](../TODO.md) - 任务列表
- [STATE.md](../STATE.md) - 开发状态跟踪
- [AUTO-DEV-GUIDE.md](../AUTO-DEV-GUIDE.md) - 详细使用指南
- [dev.log](../dev.log) - 开发日志（自动生成）
- [test.log](../test.log) - 测试日志（自动生成）

## ⚠️ 注意事项

1. **定期备份**：脚本会修改代码，建议定期 git commit
2. **监控进度**：不要完全无人值守，定期检查日志
3. **资源限制**：Claude API 有使用限制，脚本已内置等待时间
4. **测试环境**：确保测试环境配置正确

## 🔧 故障排除

### 问题：脚本无法执行

**解决：**
```bash
chmod +x scripts/*.sh
chmod +x dev.sh
```

### 问题：找不到 TODO.md

**解决：**
确保在项目根目录运行脚本，或使用 `dev.sh`

### 问题：Claude Code 未安装

**解决：**
访问 https://claude.ai/code 安装 Claude Code CLI

### 问题：测试失败

**解决：**
1. 查看 `test.log` 了解失败原因
2. 手动修复代码或测试
3. 重新运行 `./dev.sh start`

## 📚 更多信息

查看 [AUTO-DEV-GUIDE.md](../AUTO-DEV-GUIDE.md) 了解完整使用指南。
