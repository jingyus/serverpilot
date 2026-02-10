#!/usr/bin/env python3
# -*- coding: UTF-8 -*-
"""
ServerPilot 自动开发通知脚本
发送任务完成/失败的邮件通知
"""

import smtplib
import sys
from email.mime.text import MIMEText
from datetime import datetime

# 163 邮箱 SMTP 配置
SMTP_SERVER = 'smtp.163.com'
SMTP_PORT = 25
SENDER_EMAIL = 'jyedu998@163.com'
SENDER_PASSWORD = 'BENBOKVKJDJBAZCV'
RECEIVER_EMAIL = 'jingyus@126.com'


def send_notification(title, message, status="info"):
    """发送邮件通知

    Args:
        title: 邮件标题
        message: 邮件内容
        status: 状态类型 (success/error/info)
    """
    # 根据状态选择颜色和图标
    if status == "success":
        color = "#28a745"
        icon = "✅"
    elif status == "error":
        color = "#dc3545"
        icon = "❌"
    else:
        color = "#17a2b8"
        icon = "ℹ️"

    # HTML 邮件模板
    html_content = f'''<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>{title}</title>
    <style>
        body {{
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #f4f4f4;
            margin: 0;
            padding: 20px;
        }}
        .container {{
            max-width: 600px;
            margin: 0 auto;
            background-color: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            overflow: hidden;
        }}
        .header {{
            background-color: {color};
            color: white;
            padding: 20px;
            text-align: center;
        }}
        .header h1 {{
            margin: 0;
            font-size: 24px;
        }}
        .content {{
            padding: 30px;
            line-height: 1.6;
        }}
        .message {{
            background-color: #f8f9fa;
            border-left: 4px solid {color};
            padding: 15px;
            margin: 15px 0;
            white-space: pre-wrap;
            font-family: 'Courier New', monospace;
            font-size: 14px;
        }}
        .footer {{
            background-color: #f8f9fa;
            padding: 15px;
            text-align: center;
            color: #6c757d;
            font-size: 12px;
        }}
        .timestamp {{
            color: #6c757d;
            font-size: 12px;
            margin-top: 10px;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>{icon} ServerPilot 自动开发通知</h1>
        </div>
        <div class="content">
            <h2 style="color: {color}; margin-top: 0;">{title}</h2>
            <div class="message">{message}</div>
            <div class="timestamp">
                通知时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
            </div>
        </div>
        <div class="footer">
            <p>这是一封自动发送的邮件，请勿回复。</p>
            <p>ServerPilot AI 自循环开发系统</p>
        </div>
    </div>
</body>
</html>'''

    try:
        # 创建邮件对象
        msg = MIMEText(html_content, 'html', 'utf-8')
        msg['Subject'] = f'[ServerPilot] {title}'
        msg['From'] = SENDER_EMAIL
        msg['To'] = RECEIVER_EMAIL

        # 连接 SMTP 服务器并发送
        smtp = smtplib.SMTP()
        smtp.connect(SMTP_SERVER, SMTP_PORT)
        smtp.login(SENDER_EMAIL, SENDER_PASSWORD)
        smtp.sendmail(SENDER_EMAIL, [RECEIVER_EMAIL], msg.as_string())
        smtp.quit()

        print(f"✅ 邮件发送成功: {title}")
        return True

    except Exception as e:
        print(f"❌ 邮件发送失败: {e}")
        return False


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("用法: python3 send-notification.py <标题> <消息> [状态]")
        print("状态: success/error/info (默认: info)")
        sys.exit(1)

    title = sys.argv[1]
    message = sys.argv[2]
    status = sys.argv[3] if len(sys.argv) > 3 else "info"

    success = send_notification(title, message, status)
    sys.exit(0 if success else 1)
