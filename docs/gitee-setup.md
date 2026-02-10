# Gitee 远程仓库配置指南

> 配置 Gitee 认证，实现自动推送

---

## 当前状态

✅ 远程仓库已配置：`https://gitee.com/jingjinbao/serverpilot.git`
✅ 本地 Git 提交正常
❌ 推送到远程需要认证配置

---

## 方案一：使用 HTTPS + 用户名密码（推荐）

### 步骤 1：配置用户名密码

```bash
# 方式 A：在 URL 中包含用户名
git remote set-url origin https://jingjinbao@gitee.com/jingjinbao/serverpilot.git

# 推送时会提示输入密码
git push -u origin master
```

### 步骤 2：保存凭证（避免每次输入）

```bash
# 永久保存凭证
git config --global credential.helper store

# 或者缓存 15 分钟
git config --global credential.helper 'cache --timeout=900'

# 下次推送时输入用户名密码，会自动保存
git push -u origin master
```

---

## 方案二：使用 SSH 密钥（更安全）

### 步骤 1：生成 SSH 密钥

```bash
# 生成新密钥（如果已有可跳过）
ssh-keygen -t ed25519 -C "your_email@example.com"

# 按 Enter 使用默认路径：~/.ssh/id_ed25519
# 可以设置密码，也可以留空
```

### 步骤 2：查看公钥

```bash
cat ~/.ssh/id_ed25519.pub
```

复制输出的公钥内容（以 `ssh-ed25519` 开头）

### 步骤 3：添加到 Gitee

1. 登录 Gitee：https://gitee.com
2. 进入「设置」→「SSH 公钥」
3. 标题：任意名称（如 "MacBook Pro"）
4. 公钥：粘贴刚才复制的内容
5. 点击「确定」

### 步骤 4：修改远程 URL 为 SSH

```bash
git remote set-url origin git@gitee.com:jingjinbao/serverpilot.git
```

### 步骤 5：测试连接

```bash
ssh -T git@gitee.com
# 输出：Hi jingjinbao! You've successfully authenticated...
```

### 步骤 6：推送

```bash
git push -u origin master
```

---

## 方案三：使用 Gitee 私人令牌（适合自动化）

### 步骤 1：生成令牌

1. 登录 Gitee
2. 进入「设置」→「私人令牌」
3. 点击「生成新令牌」
4. 权限选择：`projects`（读写仓库）
5. 复制生成的令牌（只显示一次！）

### 步骤 2：配置远程 URL

```bash
# 替换 YOUR_TOKEN 为实际令牌
git remote set-url origin https://YOUR_TOKEN@gitee.com/jingjinbao/serverpilot.git
```

### 步骤 3：测试推送

```bash
git push -u origin master
```

**注意**：令牌保存在 `.git/config` 文件中，不要泄露

---

## 快速测试

配置完成后，运行以下命令测试：

```bash
# 1. 查看远程配置
git remote -v

# 2. 创建测试提交
echo "# Test" >> test.txt
git add test.txt
git commit -m "test: 测试推送"

# 3. 推送到远程
git push -u origin master

# 4. 清理测试文件
git rm test.txt
git commit -m "chore: 清理测试文件"
git push
```

---

## 验证 autorun.sh 自动推送

配置完成后，autorun.sh 会在任务成功时自动推送：

```bash
# 启动 autorun.sh
./scripts/autorun.sh

# 观察日志输出：
# [INFO] 任务成功，推送到远程仓库...
# [OK] 推送到远程成功: origin/feat/autorun-dev-20260210
```

---

## 故障排查

### 推送失败：认证失败

```
remote: Authentication failed
```

**解决**：
1. 检查用户名密码是否正确
2. 如果使用令牌，检查是否过期
3. 如果使用 SSH，检查密钥是否正确添加

### 推送失败：没有权限

```
remote: Permission denied
```

**解决**：
1. 确认你是该仓库的成员
2. 检查令牌权限是否包含 `projects`
3. 联系仓库管理员添加权限

### SSH 连接超时

```
ssh: connect to host gitee.com port 22: Operation timed out
```

**解决**：
1. 检查网络连接
2. 尝试使用 HTTPS 方式
3. 配置 SSH 使用 443 端口：

```bash
# ~/.ssh/config
Host gitee.com
    Hostname ssh.gitee.com
    Port 443
```

---

## 推荐方案对比

| 方案 | 安全性 | 便捷性 | 适用场景 |
|------|--------|--------|----------|
| HTTPS + 密码 | ⭐⭐⭐ | ⭐⭐⭐⭐ | 个人开发 |
| SSH 密钥 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 推荐方案 |
| 私人令牌 | ⭐⭐⭐⭐ | ⭐⭐⭐ | CI/CD 自动化 |

**推荐**：使用 **SSH 密钥** 方式，安全且无需每次输入密码

---

## 参考资料

- [Gitee SSH 公钥管理](https://gitee.com/help/articles/4181)
- [Gitee 私人令牌](https://gitee.com/help/articles/4191)
- [Git 凭证管理](https://git-scm.com/book/zh/v2/Git-%E5%B7%A5%E5%85%B7-%E5%87%AD%E8%AF%81%E5%AD%98%E5%82%A8)

---

**最后更新**：2026-02-10
