#!/bin/bash
#
# Git 初始推送脚本
# 推送项目到新分支，不覆盖远程 master
#

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo -e "${BLUE}ServerPilot 初始推送脚本${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo ""

# 检查是否是 git 仓库
if [ ! -d ".git" ]; then
    echo -e "${RED}错误：当前目录不是 Git 仓库${NC}"
    exit 1
fi

# 检查远程仓库
if ! git remote | grep -q "origin"; then
    echo -e "${RED}错误：未配置远程仓库${NC}"
    echo "请先运行：git remote add origin <repo-url>"
    exit 1
fi

echo -e "${GREEN}✓ Git 仓库检查通过${NC}"
echo ""

# 显示远程仓库信息
echo -e "${BLUE}远程仓库信息：${NC}"
git remote -v
echo ""

# 询问认证方式
echo -e "${YELLOW}请选择认证方式：${NC}"
echo "1) HTTPS + 用户名密码（推荐新手）"
echo "2) SSH 密钥（推荐高级用户）"
echo "3) 我已配置好，直接推送"
echo ""
read -p "请选择 [1-3]: " auth_choice

case $auth_choice in
    1)
        echo ""
        echo -e "${BLUE}配置 HTTPS 认证...${NC}"

        # 配置凭证保存
        git config --global credential.helper store
        echo -e "${GREEN}✓ 凭证将在首次推送后保存${NC}"
        echo ""

        # 确保 URL 是 HTTPS 格式
        current_url=$(git remote get-url origin)
        if [[ $current_url == git@* ]]; then
            https_url=$(echo "$current_url" | sed 's|git@gitee.com:|https://gitee.com/|')
            git remote set-url origin "$https_url"
            echo -e "${GREEN}✓ 已切换到 HTTPS URL${NC}"
        fi
        ;;
    2)
        echo ""
        echo -e "${BLUE}配置 SSH 认证...${NC}"

        # 检查是否已有 SSH 密钥
        if [ -f ~/.ssh/id_ed25519.pub ]; then
            echo -e "${GREEN}✓ 检测到已有 SSH 密钥${NC}"
            echo ""
            echo "你的公钥："
            cat ~/.ssh/id_ed25519.pub
            echo ""
        elif [ -f ~/.ssh/id_rsa.pub ]; then
            echo -e "${GREEN}✓ 检测到已有 SSH 密钥${NC}"
            echo ""
            echo "你的公钥："
            cat ~/.ssh/id_rsa.pub
            echo ""
        else
            echo -e "${YELLOW}未检测到 SSH 密钥，正在生成...${NC}"
            ssh-keygen -t ed25519 -C "serverpilot@gitee" -f ~/.ssh/id_ed25519 -N ""
            echo ""
            echo -e "${GREEN}✓ SSH 密钥生成成功${NC}"
            echo ""
            echo "你的公钥："
            cat ~/.ssh/id_ed25519.pub
            echo ""
        fi

        echo -e "${YELLOW}请将上面的公钥添加到 Gitee：${NC}"
        echo "1. 访问：https://gitee.com/profile/sshkeys"
        echo "2. 点击「添加公钥」"
        echo "3. 粘贴上面的公钥内容"
        echo ""
        read -p "完成后按 Enter 继续..."

        # 确保 URL 是 SSH 格式
        current_url=$(git remote get-url origin)
        if [[ $current_url == https://* ]]; then
            ssh_url=$(echo "$current_url" | sed 's|https://gitee.com/|git@gitee.com:|')
            git remote set-url origin "$ssh_url"
            echo -e "${GREEN}✓ 已切换到 SSH URL${NC}"
        fi

        # 测试 SSH 连接
        echo ""
        echo -e "${BLUE}测试 SSH 连接...${NC}"
        if ssh -T git@gitee.com 2>&1 | grep -q "successfully"; then
            echo -e "${GREEN}✓ SSH 连接成功${NC}"
        else
            echo -e "${YELLOW}⚠ SSH 连接测试未通过，但可以继续尝试推送${NC}"
        fi
        ;;
    3)
        echo -e "${GREEN}✓ 跳过认证配置${NC}"
        ;;
    *)
        echo -e "${RED}无效选择${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo -e "${BLUE}准备推送项目${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo ""

# 显示当前分支
current_branch=$(git branch --show-current)
echo -e "当前分支：${GREEN}${current_branch}${NC}"

# 显示提交信息
commit_count=$(git rev-list --count HEAD)
echo -e "提交数量：${GREEN}${commit_count}${NC}"

# 显示文件统计
file_count=$(git ls-files | wc -l | tr -d ' ')
echo -e "文件数量：${GREEN}${file_count}${NC}"

echo ""

# 询问目标分支
echo -e "${YELLOW}推送到哪个远程分支？${NC}"
echo "1) feat/initial-setup（推荐，不覆盖 master）"
echo "2) 自定义分支名"
echo ""
read -p "请选择 [1-2]: " branch_choice

case $branch_choice in
    1)
        target_branch="feat/initial-setup"
        ;;
    2)
        read -p "请输入分支名: " custom_branch
        target_branch="$custom_branch"
        ;;
    *)
        echo -e "${RED}无效选择${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${BLUE}推送配置：${NC}"
echo -e "  本地分支：${current_branch}"
echo -e "  远程分支：origin/${target_branch}"
echo -e "  ${RED}不会覆盖${NC} origin/master"
echo ""

read -p "确认推送？[y/N] " confirm
if [[ ! $confirm =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}取消推送${NC}"
    exit 0
fi

echo ""
echo -e "${BLUE}开始推送...${NC}"
echo ""

# 执行推送
if git push -u origin "$current_branch:$target_branch"; then
    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✅ 推送成功！${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
    echo ""
    echo -e "远程分支：${GREEN}origin/${target_branch}${NC}"
    echo ""
    echo "查看远程仓库："
    git_url=$(git remote get-url origin)
    if [[ $git_url == git@* ]]; then
        web_url=$(echo "$git_url" | sed 's|git@gitee.com:|https://gitee.com/|' | sed 's|\.git$||')
    else
        web_url=$(echo "$git_url" | sed 's|\.git$||')
    fi
    echo "  $web_url/tree/$target_branch"
    echo ""
else
    echo ""
    echo -e "${RED}═══════════════════════════════════════════════${NC}"
    echo -e "${RED}❌ 推送失败${NC}"
    echo -e "${RED}═══════════════════════════════════════════════${NC}"
    echo ""
    echo "可能的原因："
    echo "1. 认证失败 - 请检查用户名密码或 SSH 密钥"
    echo "2. 网络问题 - 请检查网络连接"
    echo "3. 权限不足 - 请确认你有仓库的推送权限"
    echo ""
    echo "查看详细配置指南："
    echo "  docs/gitee-setup.md"
    echo ""
    exit 1
fi
