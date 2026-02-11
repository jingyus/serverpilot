# Python 安装指南

## 安装

Python 是通用编程语言，广泛用于 Web 开发、数据科学、自动化运维和 AI/ML。生产环境推荐使用 Python 3.10+ 版本，建议通过虚拟环境隔离项目依赖。

## Ubuntu/Debian 安装

### 使用 APT 包管理器

```bash
# 安装系统 Python
sudo apt update
sudo apt install -y python3 python3-pip python3-venv

# 启用 python 命令别名
sudo apt install -y python-is-python3

# 验证
python3 --version
pip3 --version
```

### 安装指定版本（deadsnakes PPA）

```bash
# 添加 PPA
sudo apt install -y software-properties-common
sudo add-apt-repository -y ppa:deadsnakes/ppa
sudo apt update

# 安装 Python 3.12
sudo apt install -y python3.12 python3.12-venv python3.12-dev

# 验证
python3.12 --version
```

## CentOS/RHEL 安装

```bash
# CentOS 8 / RHEL 8+
sudo dnf install -y python3 python3-pip python3-devel

# CentOS 7（默认 Python 2，需手动安装 3）
sudo yum install -y epel-release
sudo yum install -y python3 python3-pip

# 启动
python3 --version
pip3 --version
```

## macOS 安装

```bash
# 使用 Homebrew
brew install python@3.12

# 添加到 PATH
echo 'export PATH="/opt/homebrew/opt/python@3.12/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# 验证
python3 --version
pip3 --version
```

## 编译安装（通用）

```bash
# 安装依赖（Ubuntu/Debian）
sudo apt install -y build-essential zlib1g-dev libncurses5-dev \
  libgdbm-dev libnss3-dev libssl-dev libreadline-dev libffi-dev \
  libsqlite3-dev wget libbz2-dev

# 下载源码
wget https://www.python.org/ftp/python/3.12.4/Python-3.12.4.tgz
tar -xzf Python-3.12.4.tgz
cd Python-3.12.4

# 编译安装
./configure --enable-optimizations --with-lto
make -j$(nproc)
sudo make altinstall  # altinstall 不覆盖系统 python3

# 验证
python3.12 --version
```

## Docker 安装

```bash
# 基础运行
docker run -it python:3.12-slim python

# 开发环境
docker run -it \
  --name python-dev \
  -v $(pwd):/app \
  -w /app \
  python:3.12-slim bash

# Dockerfile 示例
# FROM python:3.12-slim
# WORKDIR /app
# COPY requirements.txt .
# RUN pip install --no-cache-dir -r requirements.txt
# COPY . .
# CMD ["python", "app.py"]
```

## pyenv 版本管理

```bash
# 安装 pyenv
curl https://pyenv.run | bash

# 添加到 shell 配置
echo 'export PYENV_ROOT="$HOME/.pyenv"' >> ~/.bashrc
echo 'export PATH="$PYENV_ROOT/bin:$PATH"' >> ~/.bashrc
echo 'eval "$(pyenv init -)"' >> ~/.bashrc
source ~/.bashrc

# 安装指定版本
pyenv install 3.12.4
pyenv global 3.12.4

# 验证
python --version
```

## 安装后验证

```bash
# 版本信息
python3 --version
pip3 --version

# 测试模块导入
python3 -c "import ssl; print(ssl.OPENSSL_VERSION)"
python3 -c "import sqlite3; print('SQLite OK')"

# 创建虚拟环境
python3 -m venv /tmp/test-venv
source /tmp/test-venv/bin/activate
pip install requests
python -c "import requests; print('requests OK')"
deactivate
rm -rf /tmp/test-venv
```

## 关键文件路径

| 文件/目录 | 路径 |
|-----------|------|
| 系统 Python | `/usr/bin/python3` |
| pip 配置 | `~/.config/pip/pip.conf` 或 `~/.pip/pip.conf` |
| 全局包目录 | `/usr/lib/python3/dist-packages/` |
| 用户包目录 | `~/.local/lib/python3.x/site-packages/` |
| pyenv 目录 | `~/.pyenv/` |
| 虚拟环境 | 项目目录下 `.venv/` 或 `venv/` |
