# Python 故障排查与安全加固

## 常见故障排查

### 1. pip 安装失败

**症状**: `pip install` 报错超时或依赖冲突

```bash
# 检查 pip 版本
pip --version

# 升级 pip
python3 -m pip install --upgrade pip

# 使用国内镜像加速
pip install <package> -i https://mirrors.aliyun.com/pypi/simple/

# 依赖冲突排查
pip check
pip install pipdeptree
pipdeptree --warn all

# 强制重装
pip install --force-reinstall <package>

# 常见原因：
# - 网络超时（使用镜像源）
# - 依赖版本冲突
# - 缺少系统编译依赖（gcc, libffi-dev 等）
# - Python 版本不兼容
```

### 2. ModuleNotFoundError

**症状**: `ModuleNotFoundError: No module named 'xxx'`

```bash
# 确认 Python 路径
which python3
python3 -c "import sys; print(sys.executable)"

# 确认包是否安装
pip list | grep <package>

# 检查虚拟环境
echo $VIRTUAL_ENV

# 检查 sys.path
python3 -c "import sys; print('\n'.join(sys.path))"

# 常见原因：
# - 未激活虚拟环境
# - pip 和 python 指向不同版本
# - 包安装在全局而非虚拟环境
# - 包名与导入名不一致（如 pip install Pillow → import PIL）
```

### 3. 编码错误

**症状**: `UnicodeDecodeError` 或 `UnicodeEncodeError`

```bash
# 检查系统编码
python3 -c "import sys; print(sys.getdefaultencoding())"
python3 -c "import locale; print(locale.getpreferredencoding())"

# 设置环境变量
export PYTHONIOENCODING=utf-8
export LC_ALL=en_US.UTF-8

# 常见原因：
# - 文件编码与读取方式不匹配
# - 系统 locale 配置不当
# - 终端不支持 UTF-8
```

### 4. 内存泄漏

**症状**: 进程内存持续增长不释放

```bash
# 监控内存
pip install memory_profiler
python3 -m memory_profiler script.py

# 查看对象引用
python3 -c "
import gc
gc.collect()
print(f'Garbage: {len(gc.garbage)}')
"

# 使用 tracemalloc 追踪
python3 -c "
import tracemalloc
tracemalloc.start()
# ... 运行代码
snapshot = tracemalloc.take_snapshot()
for stat in snapshot.statistics('lineno')[:10]:
    print(stat)
"

# 常见原因：
# - 循环引用
# - 全局变量缓存无限增长
# - 未关闭的文件/连接
# - C 扩展内存泄漏
```

### 5. 进程卡死 / 死锁

**症状**: Python 进程无响应，CPU 使用低

```bash
# 查看进程状态
ps aux | grep python
strace -p <pid> -e trace=network,write

# 发送信号打印栈追踪
kill -USR1 <pid>  # 需在代码中注册信号处理

# 使用 py-spy 实时分析
pip install py-spy
py-spy dump --pid <pid>
py-spy top --pid <pid>

# 常见原因：
# - 多线程死锁（GIL + Lock）
# - 阻塞 I/O 无超时
# - 子进程等待（subprocess）
# - 数据库连接池耗尽
```

### 6. SSL/TLS 证书问题

**症状**: `SSLCertVerificationError` 或 `CERTIFICATE_VERIFY_FAILED`

```bash
# 检查 SSL 模块
python3 -c "import ssl; print(ssl.OPENSSL_VERSION)"

# 更新证书（Ubuntu/Debian）
sudo apt install -y ca-certificates
sudo update-ca-certificates

# macOS 修复
/Applications/Python\ 3.x/Install\ Certificates.command

# pip 指定证书
pip install --cert /path/to/cert <package>

# 常见原因：
# - 系统 CA 证书过期
# - 自签名证书
# - 代理拦截 HTTPS
# - macOS Python 未安装系统证书
```

## 性能优化

### 代码级优化

```bash
# 使用 cProfile 分析
python3 -m cProfile -o profile.out script.py
python3 -c "
import pstats
p = pstats.Stats('profile.out')
p.sort_stats('cumulative').print_stats(20)
"

# 使用 line_profiler 逐行分析
pip install line_profiler
kernprof -l -v script.py
```

### 部署优化

```bash
# 使用编译字节码
python3 -m compileall /opt/myapp/

# 设置优化级别
PYTHONOPTIMIZE=2 python3 app.py

# 使用 uvloop 加速异步
pip install uvloop
# import uvloop; uvloop.install()
```

## 安全加固

### 依赖安全

```bash
# 扫描已知漏洞
pip install safety
safety check

# 使用 pip-audit
pip install pip-audit
pip-audit

# 锁定依赖版本
pip install pip-tools
pip-compile requirements.in
pip-sync requirements.txt
```

### 运行时安全

```bash
# 以非 root 用户运行
useradd -r -s /bin/false appuser
su - appuser -s /bin/bash -c "python3 app.py"

# 限制文件权限
chmod 750 /opt/myapp
chmod 640 /opt/myapp/config.py

# 环境变量管理（避免硬编码密钥）
# 使用 python-dotenv
pip install python-dotenv
# from dotenv import load_dotenv
# load_dotenv()
```

### 输入验证

```python
# 使用 Pydantic 验证输入
from pydantic import BaseModel, validator

class UserInput(BaseModel):
    username: str
    email: str
    age: int

    @validator('username')
    def username_valid(cls, v):
        if not v.isalnum():
            raise ValueError('Username must be alphanumeric')
        return v
```

### 安全配置检查

```bash
# 检查 DEBUG 模式
grep -r "DEBUG.*True" /opt/myapp/

# 检查硬编码密钥
grep -rn "password\|secret\|api_key" /opt/myapp/ --include="*.py"

# 检查不安全的 pickle 使用
grep -rn "pickle.load\|pickle.loads" /opt/myapp/ --include="*.py"

# 检查 eval/exec 使用
grep -rn "eval(\|exec(" /opt/myapp/ --include="*.py"
```
