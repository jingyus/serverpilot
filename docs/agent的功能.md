# ServerPilot Agent 功能总结

## 概述

Agent 是部署在客户端服务器上的轻量级代理程序，负责与 Server 通信、环境检测、命令执行和系统监控。采用 TypeScript 开发，编译为单一二进制文件（通过 Bun 编译），无需运行时依赖。

---

## 核心功能模块

### 1. 环境检测 (detect/)

Agent 能够自动检测客户端的完整运行环境：

#### 1.1 操作系统信息
- 平台检测：macOS (darwin)、Linux、Windows
- 系统版本：macOS 使用 `sw_vers`，Linux/Windows 使用 `os.release()`
- CPU 架构：x64、arm64 等

#### 1.2 Shell 环境
- Shell 类型：bash、zsh、fish、powershell
- Shell 版本号

#### 1.3 运行时环境
- Node.js 版本（从 `process.versions.node` 获取）
- Python 版本（支持 python3 和 python 命令）

#### 1.4 包管理器检测
- **Node.js 生态**：npm、pnpm、yarn、npx、bun
- **macOS**：Homebrew
- **Linux**：apt、apt-get、yum、dnf、pacman

#### 1.5 网络连通性
- npm registry (registry.npmjs.org) 可达性检测
- GitHub (github.com) 可达性检测
- 使用 curl 实现超时检测

#### 1.6 权限检测
- Sudo 可用性检查（`sudo -n true`）
- 可写路径检测：
  - 用户主目录 (`os.homedir()`)
  - 临时目录 (`os.tmpdir()`)
  - `/usr/local/bin`
  - `/usr/local/lib`

#### 1.7 服务和端口检测
- 检测正在运行的系统服务
- 扫描开放的网络端口

#### 1.8 系统指标收集
- **CPU 使用率**：基于 `os.cpus()` 的多核平均负载
- **内存使用**：总内存 / 可用内存
- **磁盘使用**：读取磁盘 I/O 统计
- **网络流量**：入站 / 出站流量统计

#### 1.9 设备指纹生成
- 基于硬件特征生成唯一的设备标识符
- 用于 Agent 认证和设备管理

---

### 2. 命令执行 (execute/)

安全可控的命令执行系统，支持多种安全机制：

#### 2.1 命令执行器 (CommandExecutor)
- **子进程管理**：使用 `spawn` 执行命令
- **超时保护**：默认 30 秒，可配置
- **输出捕获**：stdout 和 stderr 实时捕获
- **流式输出**：支持 `onStdout`、`onStderr` 回调实时显示
- **Windows 兼容**：自动处理 `.cmd` 扩展名（npm、pnpm 等）
- **环境变量**：支持自定义环境变量，自动禁用 npm 资助提示

#### 2.2 沙箱执行 (Sandbox)
- **命令白名单**：
  - 包管理器：npm、pnpm、yarn、npx、bun
  - 系统包管理器：brew、apt、yum、dnf、pacman
  - 版本管理器：nvm、fnm、volta
  - 常用工具：node、git、curl、wget、tar、unzip
  - 验证命令：which、where、command、cat、ls、echo
- **路径访问控制**：限制命令只能在指定目录运行
- **用户确认机制**：危险操作需用户手动确认
- **Dry-run 模式**：预览命令而不实际执行

#### 2.3 快照和回滚
- **系统快照**：执行前捕获文件系统、进程、配置状态
- **回滚处理**：失败时自动恢复到快照状态
- **错误收集**：详细记录错误上下文，用于诊断

---

### 3. 安全控制 (security/)

五层安全防御体系，基于 `@aiinstaller/shared` 的共享规则：

#### 3.1 命令分类器（5 个风险等级）

**风险等级**：
1. **FORBIDDEN（禁止）**：绝对禁止执行
   - 例如：`rm -rf /`、`:(){ :|:& };:`（fork bomb）
2. **CRITICAL（关键）**：极高风险，需多重审批
   - 例如：格式化磁盘、删除系统文件
3. **RED（高危）**：高风险，需确认
   - 例如：`sudo rm -r`、`dd if=/dev/zero`
4. **YELLOW（中危）**：中等风险，记录审计
   - 例如：`npm install -g`、修改系统配置
5. **GREEN（安全）**：安全操作，直接执行
   - 例如：`npm install`、`git clone`

**规则类型**：
- **模式匹配**：正则表达式匹配命令字符串（750+ 规则）
- **参数审计**：检测危险参数和路径（45+ 参数规则，50+ 路径规则）
- **自定义规则**：支持从 JSON 文件加载用户自定义规则

#### 3.2 参数审计器
- 检测危险参数：`--force`、`--no-verify`、`-f`、`-r` 等
- 检测敏感路径：`/etc`、`/usr`、`/bin`、`~/.ssh` 等
- 支持路径前缀匹配和正则表达式

---

### 4. WebSocket 通信

#### 4.1 基础 WebSocket 客户端 (InstallClient)
- **连接管理**：建立、断开、状态跟踪
- **自动重连**：
  - 指数退避策略（base delay × 2^attempt）
  - 可配置最大重连次数（默认 5 次）
  - 最大延迟上限（默认 30 秒）
- **事件驱动**：
  - `connected`：连接建立
  - `disconnected`：连接断开
  - `message`：接收消息
  - `error`：错误事件
  - `reconnecting`：重连中
  - `reconnected`：重连成功
- **消息队列**：
  - 离线消息缓冲（断线时暂存消息）
  - 重连后自动发送队列消息
  - 支持 `trySend()`：连接时发送，断线时入队

#### 4.2 认证客户端 (AuthenticatedClient)
- **设备指纹认证**：基于硬件特征生成唯一 deviceId
- **Token 认证**：支持 serverId + agentToken 认证
- **认证流程**：
  1. 连接 WebSocket
  2. 发送 `auth.device`（设备指纹）或 `auth.local`（token）
  3. 等待 `auth.success` 响应
  4. 超时处理（默认 10 秒）
- **配额管理**：接收并存储服务器返回的配额信息

#### 4.3 协议消息类型
- `session.create`：创建会话
- `env.report`：上报环境信息
- `plan.receive`：接收安装计划
- `step.execute`：执行步骤
- `step.output`：步骤输出
- `step.complete`：步骤完成
- `error.occurred`：错误上报
- `metrics.report`：指标上报
- `session.complete`：会话完成

---

### 5. 指标上报 (MetricsClient)

定期收集并上报系统运行指标：

#### 5.1 收集的指标
- **CPU 使用率**：多核平均 CPU 占用百分比
- **内存使用**：
  - `memoryUsage`：已用内存（字节）
  - `memoryTotal`：总内存（字节）
- **磁盘使用**：
  - `diskUsage`：已用磁盘空间
  - `diskTotal`：总磁盘空间
- **网络流量**：
  - `networkIn`：入站流量（字节/秒）
  - `networkOut`：出站流量（字节/秒）

#### 5.2 上报机制
- **上报间隔**：默认 60 秒（可配置）
- **首次上报**：连接成功后立即上报一次
- **持久连接**：通过 WebSocket 保持长连接
- **重连恢复**：断线重连后自动恢复上报

---

### 6. 自动更新 (updater/)

Agent 自我更新机制，确保客户端始终运行最新版本：

#### 6.1 版本检查
- 通过 REST API 获取最新版本信息：`GET /api/v1/agent/version`
- 参数：
  - `current`：当前版本号
  - `platform`：操作系统平台
  - `arch`：CPU 架构
- 返回信息：
  - 最新版本号
  - 发布日期和更新日志
  - 下载 URL
  - SHA-256 校验和
  - Ed25519 签名文件 URL

#### 6.2 下载和验证
- **下载**：通过 HTTP(S) 下载新版本二进制文件
- **进度回调**：实时显示下载进度（已下载字节 / 总字节）
- **双重验证**：
  1. **SHA-256 校验和**：验证文件完整性
  2. **Ed25519 签名**：验证文件来源和真实性（防止中间人攻击）
- **反回滚保护**：拒绝安装比当前版本更低的版本

#### 6.3 安装机制
- **Unix 系统**：
  1. 备份当前二进制为 `.old`
  2. 移动新文件到当前位置
  3. 删除备份文件
- **Windows 系统**：
  1. 创建批处理脚本
  2. 脚本在 Agent 退出后替换二进制文件
  3. 后台运行脚本，自动清理

#### 6.4 命令行支持
- `--check-update`：检查是否有更新（不安装）
- `--update`：检查并自动安装更新

---

### 7. 用户界面 (ui/)

丰富的终端交互界面，提升用户体验：

#### 7.1 彩色输出
- **主题颜色**：
  - `success`：绿色（成功操作）
  - `error`：红色（错误信息）
  - `warn`：黄色（警告）
  - `info`：蓝色（信息提示）
  - `muted`：灰色（次要信息）

#### 7.2 进度显示
- **步骤进度条**：显示当前执行的步骤 / 总步骤数
- **下载进度条**：显示文件下载进度百分比
- **实时输出**：支持 verbose 模式实时显示命令输出

#### 7.3 表格展示
- **环境信息表格**：美化显示检测到的环境信息
- **安装计划表格**：展示即将执行的步骤列表

#### 7.4 用户交互
- **确认提示**：`confirmStep()` - 询问用户是否继续
- **选择提示**：支持多选项交互式选择
- **默认值支持**：Enter 键使用默认选项

#### 7.5 错误消息格式化
- **语法高亮**：关键字、命令、路径高亮显示
- **上下文信息**：显示命令、退出码、错误输出
- **可操作建议**：根据错误类型提供解决方案

#### 7.6 详细输出模式 (Verbose)
- **日志分类**：
  - `general`：常规信息
  - `ws`：WebSocket 通信
  - `auth`：认证过程
  - `env`：环境检测
  - `plan`：安装计划
  - `step`：步骤执行
  - `exec`：命令执行
  - `sandbox`：沙箱控制
  - `error`：错误信息
- **性能计时**：记录每个操作的耗时

---

### 8. 工作模式

Agent 支持四种工作模式：

#### 8.1 安装模式（默认）
```bash
ai-installer [software]
```
- 连接服务器
- 上报环境信息
- 接收 AI 生成的安装计划
- 逐步执行安装命令
- 上报执行结果

#### 8.2 离线模式
```bash
ai-installer --offline
```
- 仅执行环境检测
- 不连接服务器
- 显示环境信息后退出
- 用于诊断或离线场景

#### 8.3 Dry-run 模式
```bash
ai-installer --dry-run [software]
```
- 连接服务器获取安装计划
- 显示即将执行的命令
- **不实际执行命令**
- 用于预览和验证

#### 8.4 Daemon 模式
```bash
ai-installer --daemon --server-id <id> --token <token>
```
- 持久连接服务器
- 定期上报系统指标（15 秒间隔）
- 监听并执行服务器推送的命令
- 自动重连（无限次）
- 支持 SIGTERM / SIGINT 优雅退出

---

## 命令行参数

### 基础参数
- `[software]`：要安装的软件名称（默认：openclaw）
- `--server <url>`：服务器 WebSocket URL（默认：ws://localhost:3000）

### 行为控制
- `--yes, -y`：自动确认所有提示（无交互模式）
- `--verbose, -v`：启用详细输出模式
- `--dry-run`：预览模式，不执行命令
- `--offline`：离线模式，仅环境检测
- `--daemon`：守护进程模式

### 认证参数
- `--token <token>`：Agent Token（用于本地认证）
- `--server-id <id>`：服务器 ID（用于本地认证）

### 更新命令
- `--update`：检查并安装更新
- `--check-update`：仅检查更新，不安装

### 帮助信息
- `--help, -h`：显示帮助信息
- `--version`：显示版本号

---

## 环境变量

Agent 支持通过环境变量配置：

- `SP_SERVER_URL`：服务器 URL（可被 `--server` 覆盖）
- `SP_AGENT_TOKEN`：Agent Token（可被 `--token` 覆盖）
- `SP_SERVER_ID`：服务器 ID（可被 `--server-id` 覆盖）

---

## 文件系统

Agent 会使用以下文件和目录：

### Token 文件
- **位置**：`~/.serverpilot/agent.token`（或系统共享位置）
- **内容**：
  ```json
  {
    "serverId": "server-123",
    "agentToken": "token-abc..."
  }
  ```
- **用途**：Daemon 模式本地认证

### 自定义规则文件
- **格式**：JSON
- **结构**：
  ```json
  {
    "rules": [
      {
        "pattern": "^myapp deploy",
        "level": "green",
        "reason": "Trusted deployment command"
      }
    ]
  }
  ```

---

## 安全特性

### 五层防御体系
1. **命令分类**：750+ 内置规则 + 自定义规则
2. **参数审计**：45+ 危险参数 + 50+ 敏感路径检测
3. **沙箱执行**：白名单 + 路径隔离 + 用户确认
4. **快照回滚**：执行前快照 + 失败自动恢复
5. **审计日志**：所有操作记录到服务器

### 安全机制
- **设备指纹认证**：防止未授权 Agent 连接
- **Ed25519 签名验证**：防止二进制文件被篡改
- **反回滚保护**：拒绝安装旧版本
- **超时保护**：所有命令强制超时
- **权限最小化**：仅白名单命令可执行

---

## 技术细节

### 编译和打包
- **开发语言**：TypeScript
- **运行时**：Node.js 22+
- **编译工具**：Bun（编译为单一二进制）
- **目标平台**：
  - macOS (darwin): x64, arm64
  - Linux: x64, arm64
  - Windows: x64

### 依赖库
- `ws`：WebSocket 客户端
- `@aiinstaller/shared`：共享协议和安全规则
- Node.js 内置模块：`child_process`、`fs`、`os`、`crypto`

### 协议
- **传输层**：WebSocket（RFC 6455）
- **消息格式**：JSON
- **消息结构**：
  ```json
  {
    "type": "session.create",
    "payload": { ... }
  }
  ```

---

## 总结

ServerPilot Agent 是一个功能完备的客户端代理程序，具备以下特点：

✅ **全面的环境检测**：自动识别操作系统、运行时、包管理器、网络状态
✅ **安全的命令执行**：五层防御体系，750+ 安全规则，沙箱隔离
✅ **智能的错误处理**：快照回滚、详细错误信息、自动诊断
✅ **稳定的通信机制**：自动重连、离线队列、持久连接
✅ **实时的系统监控**：CPU、内存、磁盘、网络指标上报
✅ **便捷的自动更新**：双重验证、反回滚保护、无缝升级
✅ **友好的用户界面**：彩色输出、进度条、交互式确认

适用场景：
- 🚀 一键安装软件环境
- 📊 服务器资源监控
- 🔒 安全的远程命令执行
- 🤖 AI 驱动的自动化运维
