# ServerPilot 快速开始

> 5 分钟上手指南

---

## 1. 推送项目到 Gitee（首次）

```bash
# 运行一键推送脚本
./scripts/git-push-initial.sh
```

**或者手动推送：**
```bash
# 保存凭证
git config --global credential.helper store

# 推送到新分支（不覆盖 master）
git push -u origin master:feat/initial-setup
```

---

## 2. 启动 AI 自动开发

```bash
# 启动自动循环开发
./scripts/autorun.sh
```

**功能：**
- ✅ AI 自动分析项目
- ✅ AI 自动生成任务
- ✅ AI 自动实现功能
- ✅ 自动运行测试
- ✅ 任务成功自动推送到 Gitee

---

## 3. 查看开发状态

```bash
# 实时日志
tail -f autorun.log

# 开发历史
cat AUTORUN_STATE.md

# 当前任务
cat CURRENT_TASK.md

# Git 提交记录
git log --oneline --author="ServerPilot Bot"
```

---

## 4. 手动开发

```bash
# 安装依赖
pnpm install

# 启动开发服务
pnpm dev

# 运行测试
pnpm test

# 构建
pnpm build
```

---

## 常见命令

### Git 操作
```bash
# 查看远程仓库
git remote -v

# 查看分支
git branch -a

# 查看状态
git status

# 查看最近提交
git log --oneline -10
```

### 停止自动开发
```bash
# 在运行的终端按 Ctrl+C
# 或从另一个终端：
pkill -f autorun.sh
```

---

## 文档参考

| 文档 | 用途 |
|------|------|
| [README.md](./README.md) | 项目介绍 |
| [docs/autorun-development.md](./docs/autorun-development.md) | autorun.sh 设计文档 |
| [docs/git-integration-guide.md](./docs/git-integration-guide.md) | Git 使用指南 |
| [docs/gitee-setup.md](./docs/gitee-setup.md) | Gitee 认证配置 |
| [docs/开发标准.md](./docs/开发标准.md) | 开发规范 |

---

## 目录结构

```
ServerPilot/
├── scripts/
│   ├── autorun.sh              # AI 自动开发主脚本
│   └── git-push-initial.sh     # 一键推送脚本
│
├── docs/                        # 文档目录
│   ├── autorun-development.md  # 开发文档
│   ├── autorun-changelog.md    # 版本历史
│   ├── git-integration-guide.md
│   ├── gitee-setup.md
│   └── ...
│
├── packages/                    # 代码包
│   ├── server/                 # 服务端
│   ├── agent/                  # Agent
│   ├── dashboard/              # 前端
│   └── shared/                 # 共享代码
│
├── AUTORUN_STATE.md            # AI 开发历史（自动生成）
├── CURRENT_TASK.md             # 当前任务（自动生成）
└── autorun.log                 # 详细日志（追加模式）
```

---

## 注意事项

⚠️ **敏感文件保护**
- `.env` 文件已在 .gitignore 中排除
- 不会被提交到 Git
- API Keys 等敏感信息安全

✅ **自动推送策略**
- 任务成功 → 自动推送到远程
- 任务失败 → 仅本地提交
- 保护远程代码质量

📝 **日志保留**
- autorun.log 采用追加模式
- 保留所有历史记录
- 方便问题追溯

---

**需要帮助？** 查看 [docs/](./docs/) 目录下的详细文档
