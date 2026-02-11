# Python 常用配置模板

## pip 配置

```ini
# ~/.config/pip/pip.conf (Linux/macOS)
# %APPDATA%\pip\pip.ini (Windows)
[global]
index-url = https://pypi.org/simple/
trusted-host = pypi.org
timeout = 60
retries = 3

[install]
# 使用国内镜像（加速）
# index-url = https://mirrors.aliyun.com/pypi/simple/
no-cache-dir = false
```

## 虚拟环境管理

### venv（标准库）

```bash
# 创建虚拟环境
python3 -m venv .venv

# 激活
source .venv/bin/activate       # Linux/macOS
# .venv\Scripts\activate        # Windows

# 安装依赖
pip install -r requirements.txt

# 导出依赖
pip freeze > requirements.txt

# 退出
deactivate
```

### requirements.txt 模板

```txt
# requirements.txt - 生产依赖
flask==3.0.3
gunicorn==22.0.0
psycopg2-binary==2.9.9
redis==5.0.7
celery==5.4.0
pydantic==2.8.0

# requirements-dev.txt - 开发依赖
-r requirements.txt
pytest==8.2.0
pytest-cov==5.0.0
black==24.4.0
ruff==0.5.0
mypy==1.10.0
```

### pyproject.toml 配置

```toml
[project]
name = "myproject"
version = "1.0.0"
requires-python = ">=3.10"
dependencies = [
    "flask>=3.0",
    "pydantic>=2.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "ruff>=0.5",
]

[tool.ruff]
target-version = "py310"
line-length = 88

[tool.ruff.lint]
select = ["E", "F", "I", "N", "W"]

[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = "test_*.py"

[tool.mypy]
python_version = "3.10"
strict = true
```

## Gunicorn 生产部署

```python
# gunicorn.conf.py
import multiprocessing

# 绑定地址
bind = "0.0.0.0:8000"

# Worker 配置
workers = multiprocessing.cpu_count() * 2 + 1
worker_class = "gthread"
threads = 2
timeout = 120
keepalive = 5

# 日志
accesslog = "/var/log/gunicorn/access.log"
errorlog = "/var/log/gunicorn/error.log"
loglevel = "info"

# 进程管理
daemon = False
pidfile = "/var/run/gunicorn/gunicorn.pid"
graceful_timeout = 30
max_requests = 1000
max_requests_jitter = 50
```

## systemd 服务配置

```ini
# /etc/systemd/system/myapp.service
[Unit]
Description=My Python Application
After=network.target

[Service]
Type=notify
User=www-data
Group=www-data
WorkingDirectory=/opt/myapp
Environment="PATH=/opt/myapp/.venv/bin"
ExecStart=/opt/myapp/.venv/bin/gunicorn \
    --config gunicorn.conf.py \
    myapp.wsgi:app
ExecReload=/bin/kill -s HUP $MAINPID
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

```bash
# 启用服务
sudo systemctl daemon-reload
sudo systemctl enable myapp
sudo systemctl start myapp
sudo systemctl status myapp
```

## uWSGI 配置

```ini
# uwsgi.ini
[uwsgi]
module = myapp.wsgi:app
master = true
processes = 4
threads = 2

socket = /tmp/myapp.sock
chmod-socket = 660
vacuum = true

die-on-term = true
max-requests = 5000
harakiri = 120

# 日志
logto = /var/log/uwsgi/myapp.log
log-maxsize = 10485760
```

## 日志配置

```python
# logging_config.py
import logging.config

LOGGING_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "standard": {
            "format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
        },
        "json": {
            "format": '{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","message":"%(message)s"}'
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "standard",
            "level": "DEBUG",
        },
        "file": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": "/var/log/myapp/app.log",
            "maxBytes": 10485760,  # 10MB
            "backupCount": 5,
            "formatter": "json",
            "level": "INFO",
        },
    },
    "root": {
        "handlers": ["console", "file"],
        "level": "INFO",
    },
}

logging.config.dictConfig(LOGGING_CONFIG)
```

## Celery 异步任务配置

```python
# celery_config.py
broker_url = "redis://localhost:6379/0"
result_backend = "redis://localhost:6379/1"

task_serializer = "json"
result_serializer = "json"
accept_content = ["json"]
timezone = "UTC"

# 并发配置
worker_concurrency = 4
worker_prefetch_multiplier = 1
task_acks_late = True

# 任务超时
task_soft_time_limit = 300
task_time_limit = 600

# 定时任务
beat_schedule = {
    "cleanup-every-hour": {
        "task": "tasks.cleanup",
        "schedule": 3600.0,
    },
}
```
