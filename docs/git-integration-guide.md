# Git 集成使用指南

> autorun.sh 自动 Git 提交功能说明

---

## 功能概述

autorun.sh 已集成自动 Git 提交功能，每次任务完成后会自动：
1. 创建/切换到开发分支 `feat/autorun-dev-{日期}`
2. 添加所有变更文件（遵循 .gitignore 规则）
3. 使用标准格式生成 commit message
4. 执行 git commit
5. 可选：推送到远程仓库

---

## .gitignore 配置

已配置忽略以下文件（**不会被提交**）：

### 敏感文件
```
.env                    # ✅ 环境变量（API Keys等）
.env.local
.env.*.local
.env.production
```

### 生成文件
```
node_modules/           # 依赖包
dist/                   # 构建输出
*.log                   # 日志文件
coverage/               # 测试覆盖率报告
```

### 状态文件
```
AUTORUN_STATE.md        # AI 开发历史（动态生成）
CURRENT_TASK.md         # 当前任务（动态生成）
STATE.md                # 开发状态（动态生成）
```

---

## 自动提交流程

### 每次任务成功后

```bash
[步骤 1] 检查是否有文件变更
[步骤 2] 创建/切换分支 feat/autorun-dev-20260210
[步骤 3] 执行 git add -A（排除 .gitignore 的文件）
[步骤 4] 生成 commit message:
         feat: {任务名称}

         Generated-By: autorun.sh (AI-driven development)
         Task-File: CURRENT_TASK.md
         Round: {轮次}
         Status: ✅ 完成
[步骤 5] 执行 git commit
[步骤 6] [可选] 推送到远程 origin
```

---

## Commit Message 格式

遵循项目开发标准（docs/开发标准.md）：

### 格式
```
<type>: <subject>

Generated-By: autorun.sh (AI-driven development)
Task-File: CURRENT_TASK.md
Round: <iteration>
Status: <status>
```

### 类型（type）
- `feat`: 新功能开发
- `fix`: Bug 修复
- `refactor`: 代码重构
- `test`: 测试相关
- `docs`: 文档更新
- `chore`: 构建/工具

### 示例
```
feat: 文档自动抓取功能集成与测试

Generated-By: autorun.sh (AI-driven development)
Task-File: CURRENT_TASK.md
Round: 3
Status: ✅ 完成
```

---

## 分支管理

### 自动创建的分支

```bash
feat/autorun-dev-20260210    # 按日期创建开发分支
feat/autorun-dev-20260211    # 第二天会创建新分支
```

### 分支合并

完成一天的开发后，可以手动合并：

```bash
# 1. 切换到主分支
git checkout main

# 2. 合并开发分支
git merge feat/autorun-dev-20260210

# 3. 推送到远程
git push origin main

# 4. 删除本地分支（可选）
git branch -d feat/autorun-dev-20260210
```

---

## 远程仓库配置

### 添加远程仓库

```bash
# GitHub
git remote add origin https://github.com/jingjinbao/serverpilot.git

# 或使用 SSH
git remote add origin git@github.com:jingjinbao/serverpilot.git
```

### 验证配置

```bash
git remote -v
# 输出:
# origin  https://github.com/jingjinbao/serverpilot.git (fetch)
# origin  https://github.com/jingjinbao/serverpilot.git (push)
```

### 自动推送

配置远程仓库后，autorun.sh 会在每次提交后自动推送：

```bash
[INFO] 检测到远程仓库，尝试推送...
[OK] 推送到远程成功
```

---

## 查看提交历史

### 查看所有提交

```bash
git log --oneline
```

### 查看 AI Bot 的提交

```bash
git log --oneline --author="ServerPilot Bot"
```

### 查看某个分支的提交

```bash
git log --oneline feat/autorun-dev-20260210
```

### 查看文件变更详情

```bash
git show HEAD              # 最新提交
git show <commit-sha>      # 指定提交
```

---

## 回滚操作

### 撤销最后一次提交（保留更改）

```bash
git reset --soft HEAD~1
```

### 撤销最后一次提交（丢弃更改）

```bash
git reset --hard HEAD~1
```

### 恢复某个文件到之前版本

```bash
git checkout <commit-sha> -- path/to/file
```

---

## 故障排查

### 提交失败：未配置用户信息

**错误**：
```
*** Please tell me who you are.
```

**解决**：
```bash
git config user.name "Your Name"
git config user.email "your@email.com"
```

### 推送失败：认证问题

**错误**：
```
remote: Permission denied
fatal: Authentication failed
```

**解决方案**：

1. **使用 HTTPS + Token**
```bash
# GitHub: Settings → Developer settings → Personal access tokens
git remote set-url origin https://<TOKEN>@github.com/jingjinbao/serverpilot.git
```

2. **使用 SSH**
```bash
# 生成 SSH 密钥
ssh-keygen -t ed25519 -C "your@email.com"

# 添加到 GitHub: Settings → SSH and GPG keys
cat ~/.ssh/id_ed25519.pub

# 修改远程 URL
git remote set-url origin git@github.com:jingjinbao/serverpilot.git
```

### 合并冲突

**现象**：
```
CONFLICT (content): Merge conflict in package.json
```

**解决**：
```bash
# 1. 手动编辑冲突文件
vim package.json  # 解决 <<<< ==== >>>> 标记

# 2. 标记为已解决
git add package.json

# 3. 完成合并
git commit
```

---

## 最佳实践

### 1. 定期检查提交

每天结束时检查提交历史：
```bash
git log --oneline --since="1 day ago"
```

### 2. 定期合并到主分支

避免开发分支积累太多提交：
```bash
# 每周合并一次
git checkout main
git merge feat/autorun-dev-{date}
```

### 3. 定期推送到远程

确保代码有备份：
```bash
git push origin main
git push origin --all  # 推送所有分支
```

### 4. 保持 .gitignore 更新

添加新的敏感文件或生成文件时，及时更新 .gitignore

### 5. 查看差异再提交

虽然是自动提交，但定期检查变更：
```bash
git diff HEAD~5..HEAD  # 查看最近 5 次提交的变更
```

---

## 与 MCP Git 服务集成（可选）

如果你使用 Claude Code 的 MCP（Model Context Protocol）服务：

### 检查可用的 MCP 服务

```bash
claude mcp list
```

### 添加 Git MCP 服务

```bash
# 示例（具体命令依赖 MCP 服务实现）
claude mcp add git --config '{"repo": "/path/to/ServerPilot"}'
```

### 好处

- Claude 可以直接查询 Git 历史
- 更智能的代码审查建议
- 更好的上下文理解

---

## 参考资料

- [开发标准](./开发标准.md) - Git 工作流详细规范
- [autorun.sh 开发文档](./autorun-development.md) - 脚本设计与实现
- [Git 官方文档](https://git-scm.com/doc)

---

**最后更新**：2026-02-10
**维护者**：ServerPilot Team
