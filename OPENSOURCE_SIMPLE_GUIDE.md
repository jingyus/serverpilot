# 🚀 ServerPilot 开源发布简易指南（不删除文件）

## ✅ 推荐方案：只用 .gitignore（最安全）

**核心原则**：
- ✅ 所有文件保留在本地（你之后还能用）
- ✅ 只通过 .gitignore 控制哪些文件不上传到 GitHub
- ✅ 不运行任何删除脚本
- ✅ 简单、安全、可逆

---

## 📋 3 步完成开源发布

### Step 1: 使用开源版 .gitignore（1 分钟）

```bash
# 复制开源版 .gitignore
cp .gitignore.opensource-example .gitignore

# 查看配置
cat .gitignore
```

### Step 2: 验证哪些文件会被忽略（2 分钟）

```bash
# 查看会被忽略的文件（前 50 个）
git status --ignored | head -50

# 应该看到这些被忽略：
# - packages/cloud/
# - docs/云*.md
# - scripts/autorun*.sh
# - AUTORUN_*.md
# - CURRENT_*.md
# - 等等...
```

### Step 3: 提交并推送（1 分钟）

```bash
# 添加 .gitignore
git add .gitignore

# 提交
git commit -m "chore: configure opensource .gitignore"

# 推送到 GitHub（内部文件不会上传）
git push origin main
```

**完成！你的内部文件都还在本地，但不会上传到 GitHub。** ✅

---

## 🔍 验证配置是否正确

### 检查 1: 确认 Cloud 包被忽略

```bash
# 查看 Cloud 包状态
git status packages/cloud/

# 应该显示：被忽略（ignored）
# 或者没有输出（表示 Git 完全忽略了它）
```

### 检查 2: 确认内部文档被忽略

```bash
# 查看内部文档状态
git status docs/云*.md
git status AUTORUN_*.md
git status scripts/autorun*.sh

# 应该都显示：被忽略（ignored）
```

### 检查 3: 确认开源文件会被提交

```bash
# 查看应该提交的文件
git status

# 应该看到：
# - README.md
# - CONTRIBUTING.md
# - packages/server/
# - packages/agent/
# - packages/dashboard/
# - packages/shared/
# - 等等...
```

### 检查 4: 模拟推送（不会真的推送）

```bash
# 查看将要推送的文件
git ls-files

# 这个命令列出所有会被 Git 跟踪的文件
# 检查列表中是否包含内部文件
# 如果包含 packages/cloud/ 或 docs/云*.md，说明配置有问题
```

---

## ⚠️ 重要说明

### ✅ 这个方案的优点

1. **安全**：不删除任何文件，所有内部资料都保留
2. **简单**：只需要 3 个命令
3. **可逆**：随时可以改回来
4. **灵活**：随时可以修改 .gitignore 规则

### ⚠️ 需要注意的

1. **Git 历史记录**：如果你之前已经提交过内部文件，它们仍然在 Git 历史中
   - 解决方案：清理 Git 历史（见下方"清理历史记录"部分）

2. **.gitignore 只对未跟踪的文件生效**：如果文件已经被 Git 跟踪，需要先移除
   - 解决方案：使用 `git rm --cached` 移除跟踪（见下方"移除已跟踪文件"部分）

---

## 🛠️ 可能需要的额外步骤

### 情况 1: 如果内部文件已经被 Git 跟踪

**症状**：运行 `git status` 时，内部文件显示为 "modified" 而不是 "ignored"

**解决方案**：
```bash
# 从 Git 跟踪中移除（文件仍保留在本地）
git rm --cached -r packages/cloud/
git rm --cached docs/云*.md
git rm --cached AUTORUN_*.md
git rm --cached CURRENT_*.md
git rm --cached scripts/autorun*.sh
# ... 等等（移除所有内部文件）

# 提交移除操作
git commit -m "chore: stop tracking internal files"

# 推送
git push origin main
```

### 情况 2: 如果 Git 历史中包含敏感信息

**症状**：虽然当前版本没有内部文件，但 Git 历史中仍然可以看到

**解决方案**：使用 `git filter-repo` 清理历史（高级操作，需谨慎）

```bash
# 安装 git-filter-repo
pip install git-filter-repo

# 备份当前仓库
cp -r . ../ServerPilot-backup

# 从历史中移除 Cloud 包
git filter-repo --path packages/cloud --invert-paths

# 从历史中移除内部文档
git filter-repo --path 'docs/云*.md' --invert-paths --use-base-name

# 强制推送（会重写 Git 历史）
git push origin main --force
```

⚠️ **警告**：`git filter-repo` 会重写 Git 历史，可能影响其他协作者。**仅在新仓库或个人项目中使用！**

---

## 📊 配置检查清单

运行以下命令，确保配置正确：

```bash
# 1. 检查 .gitignore 是否生效
git check-ignore -v packages/cloud/src/index.ts
# 应该输出：.gitignore:83:packages/cloud/    packages/cloud/src/index.ts

# 2. 检查内部文档是否被忽略
git check-ignore -v docs/云服务实施方案.md
# 应该输出：.gitignore:121:docs/云*.md    docs/云服务实施方案.md

# 3. 检查内部脚本是否被忽略
git check-ignore -v scripts/autorun.sh
# 应该输出：.gitignore:158:scripts/*    scripts/autorun.sh

# 4. 检查开源脚本没有被忽略
git check-ignore -v scripts/install.sh
# 应该没有输出（表示不会被忽略，会被提交）

# 5. 列出所有被忽略的文件
git status --ignored | grep -E "packages/cloud|docs/云|scripts/autorun|AUTORUN_"
# 应该看到大量被忽略的内部文件
```

---

## 🎯 最简化流程（推荐）

### 如果你的仓库是新的（还没推送过内部文件）

```bash
# 1. 使用开源 .gitignore
cp .gitignore.opensource-example .gitignore

# 2. 提交
git add .gitignore
git commit -m "chore: add opensource .gitignore"

# 3. 推送
git push origin main

# 完成！内部文件都在本地，但不会上传
```

### 如果你的仓库已经推送过内部文件

```bash
# 1. 使用开源 .gitignore
cp .gitignore.opensource-example .gitignore

# 2. 从 Git 移除已跟踪的内部文件（文件保留在本地）
git rm --cached -r packages/cloud/
git rm --cached docs/云*.md
git rm --cached AUTORUN_*.md CURRENT_*.md *_TASK_QUEUE.md
git rm --cached scripts/autorun*.sh scripts/task-queue-helper.sh
git rm --cached tests/docker-compose-ee.test.ts tests/e2e-ce-to-ee-upgrade.test.ts

# 3. 提交
git add .gitignore
git commit -m "chore: stop tracking internal files and configure opensource .gitignore"

# 4. 推送
git push origin main

# 完成！内部文件仍在本地，但从 Git 跟踪中移除了
```

---

## ✅ 成功标志

完成后，你应该能看到：

1. ✅ 本地文件都在：
   ```bash
   ls packages/cloud/        # 文件还在！
   ls docs/云*.md            # 文件还在！
   ls scripts/autorun*.sh    # 文件还在！
   ```

2. ✅ Git 忽略了它们：
   ```bash
   git status packages/cloud/
   # 没有输出（被忽略了）
   ```

3. ✅ GitHub 上看不到它们：
   - 访问你的 GitHub 仓库
   - 应该看不到 `packages/cloud/` 目录
   - 应该看不到 `docs/云*.md` 文件

---

## 🆘 遇到问题？

### 问题 1: `.gitignore` 不生效

```bash
# 清除 Git 缓存
git rm -r --cached .
git add .
git commit -m "chore: refresh git cache"
```

### 问题 2: 不确定哪些文件会被上传

```bash
# 列出所有会被 Git 跟踪的文件
git ls-files > tracked-files.txt

# 检查这个文件，看是否包含内部文件
grep "cloud\|云\|autorun" tracked-files.txt
```

### 问题 3: 想要恢复原来的 .gitignore

```bash
# 恢复原来的 .gitignore
git checkout HEAD -- .gitignore

# 或者从其他分支恢复
git checkout master -- .gitignore
```

---

## 📚 参考资料

- ✅ 本地文件都保留
- ✅ 只通过 .gitignore 控制上传
- ✅ 不运行任何删除脚本
- ✅ 可随时修改规则

**这是最安全、最简单的开源方案！** 🎉
