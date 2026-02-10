# -*- coding: UTF-8 -*-
# !/usr/bin/python

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText


# 发送邮箱服务器
smtpserver = 'smtp.163.com'
# 发送邮箱的登录用户/密码
user = "jyedu998@163.com"
password = 'BENBOKVKJDJBAZCV'

sender = "jyedu998@163.com"  # 发送方邮箱
receivers = ['jingyus2022@163.com']  # 接收方邮箱 398826081@qq.com
att = '''<!DOCTYPE html>
<html>
<head>
  <title>Member expired</title>
  <style>
    h1 {
      font-size: 36px;
      color: #ff0000;
    }
  </style>
</head>

<body>
  <h1>grammarly premium</h1>
  <p>Sorry, your membership rights have expired. If you need to re open the membership permission, you can purchase it through the following website:</p>
  <a href="http://www.t.me/miaoxiaodong">http://www.t.me/miaoxiaodong</a>
  <p>If you have any questions during the purchase and use process, you can contact me directly.</p>
</body>
</html>
'''  # 邮件正文

#msg = MIMEMultipart('related')
msg = MIMEText(att, 'html', 'utf-8')
msg['Subject'] = 'grammlary过期'  # 邮件标题
msg["From"] = "jyedu998@163.com"
msg["To"] = '; '.join(receivers)
# file_1 = 'E:\\books\\weblogic-12.pdf'  # 要作为附件发送的文件名
# att1 = MIMEText(open(file_1, 'rb').read(), 'base64', 'utf-8')
# att1.add_header('Content-Disposition', 'attachment', filename=file_1.split('\\')[-1])
# msg.attach(att1)

smtp = smtplib.SMTP()
smtp.connect(smtpserver, 25)
smtp.login(user, password)
smtp.sendmail(sender, receivers, msg.as_string())  # 开始发送

smtp.quit()
print("send mails ok")