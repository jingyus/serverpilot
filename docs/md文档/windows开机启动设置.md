在 Windows 系统中，**让程序在开机时无需用户登录就能自动启动**，需要将这些任务注册为**Windows 服务（Windows Service）**。普通的“开机自启”方式（如启动文件夹、任务计划、注册表 Run 键）通常要求用户登录后才会运行。

你提到的几个程序：

- Tomcat（Java 应用）
- Nginx（Web 服务器）
- Python 脚本 `sync.py`（两个实例）

这些都可以通过配置成 **Windows 服务** 来实现：**系统开机即启动，不需要登录任何用户**。

---

## ✅ 方案概览

我们将使用 [NSSM (Non-Sucking Service Manager)](https://nssm.cc/) 工具来将你的程序注册为服务。这是一个简单、免费、高效的方式。

### 👉 步骤概要：
1. 下载并安装 NSSM
2. 为每个程序创建一个 Windows 服务
3. 设置服务为“开机自动启动”
4. （可选）设置服务运行账户为 `LocalSystem`

---

## 🔧 第一步：下载 NSSM

官网：https://nssm.cc/

👉 下载地址：https://nssm.cc/download

选择最新版本（比如 `nssm-2.24-101-g897c7ad.zip`），解压即可使用（无需安装）。

建议解压到：`C:\nssm\`

---

## 🚀 第二步：为每个程序创建服务

### 1. 创建 Tomcat 服务

打开命令提示符作为管理员运行：

```cmd
C:\nssm\nssm install TomcatService
```

弹出配置窗口：

- **Path**: 指向 `tomcat/bin/startup.bat` 或 `catalina.bat start`
  - 示例：`C:\tomcat\bin\startup.bat`
- **Startup directory**: `C:\tomcat\bin`
- **Arguments**: 留空（如果使用 `catalina.bat`，可以写 `start`）
- **Service name**: 填 `TomcatService`

> ✅ 推荐使用 `catalina.bat start` 启动方式更可靠。

点击 Install service。

然后设置服务自动启动：
```cmd
sc config TomcatService start= auto
```

启动服务测试：
```cmd
net start TomcatService
```

---

### 2. 创建 Nginx 服务

```cmd
C:\nssm\nssm install NginxService
```

配置：
- **Path**: `C:\nginx\nginx.exe`
- **Startup directory**: `C:\nginx`
- **Arguments**: 留空（或写 `start`）

点击 Install。

设为开机启动：
```cmd
sc config NginxService start= auto
```

测试：
```cmd
net start NginxService
```

---

### 3. 创建第一个 Python 脚本服务：`python sync.py 1`

```cmd
C:\nssm\nssm install SyncService1
```

配置：
- **Path**: `C:\Python39\python.exe`（根据你的 Python 安装路径修改）
- **Startup directory**: 脚本所在目录，如 `C:\myproject\`
- **Arguments**: `sync.py 1`

✅ 注意：确保 Python 路径正确。

设为自动启动：
```cmd
sc config SyncService1 start= auto
```

---

### 4. 创建第二个 Python 脚本服务：`python sync.py 2`

```cmd
C:\nssm\nssm install SyncService2
```

配置同上：
- **Path**: `C:\Python39\python.exe`
- **Startup directory**: `C:\myproject\`
- **Arguments**: `sync.py 2`

设为自动启动：
```cmd
sc config SyncService2 start= auto
```

---

## 🔐 第三步：设置服务登录账户（重要）

默认 NSSM 使用的是当前用户。但我们要实现在**无人登录时也能运行**，所以应设置为 `Local System Account`。

1. 打开 **服务管理器**：按 `Win + R` → 输入 `services.msc`
2. 找到你创建的服务（如 TomcatService, NginxService 等）
3. 右键 → 属性 → 登录选项卡
4. 选择：
   - **Local System account**
   - ✅ 勾选 “Allow service to interact with desktop”（可选，调试有用）
5. 应用并确认

> 这个账户不需要密码，是系统级账户，适合后台服务。

---

## 🔁 第四步：设置服务开机自启 & 测试

你已经用 `sc config xxx start= auto` 设置为自动启动。

重启电脑测试是否能自动运行：

- 查看日志：NSSM 会自动记录输出（可以在 NSSM 配置里设置日志路径）
- 或查看 Windows 事件查看器（Event Viewer）是否有错误

---

## 🛠️ 其他建议

### ✅ 日志记录（强烈推荐）
在 NSSM 配置中：
- 进入 "I/O" 标签页
- 设置 `Output (stdout)` 和 `Error (stderr)` 路径：
  - 如 `C:\logs\tomcat.log`
  - `C:\logs\sync1.log` 等
- 便于排查问题

### ✅ Python 脚本注意
- 确保脚本能独立运行（带 shebang 或使用完整 Python 解释器）
- 路径不要有中文或空格
- 最好用 `.pyw` 或在后台静默运行（避免弹窗）

---

## ❌ 不推荐的方法（为什么不用其他方式？）

| 方法 | 是否支持无登录启动 |
|------|------------------|
| 开始菜单“启动”文件夹 | ❌ 必须登录用户 |
| 注册表 `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run` | ❌ 当前用户需登录 |
| 计划任务（默认用户） | ❌ 默认需要用户登录 |
| 计划任务（设为“不管用户是否登录”） | ✅ 有可能，但复杂，权限和上下文问题多 |

👉 所以：**Windows 服务是最稳定方案**

---

## ✅ 总结：你需要做什么？

1. 下载 NSSM 并解压
2. 为每个程序运行 `nssm install <serviceName>`
3. 填写正确的路径、参数、工作目录
4. 用 `sc config xxx start= auto` 设置自动启动
5. 在服务管理器中设置登录账户为 “Local System”
6. 重启测试

---

如果你希望我生成完整的批处理脚本来一键安装这4个服务，也可以告诉我各程序的路径，我可以帮你写出 `.bat` 脚本。

需要吗？🙂