# Daily Study Buddy

一个可演示的英语学习助手 Demo。

## 功能

- 输入邮箱后开始使用
- 早晨发送学习内容
- 晚间发送选择题测验
- 支持邮件内点击选项作答
- 按邮箱查看历史学习记录和正确率
- 支持手动发送和定时发送并存

## 本地运行

1. 进入项目目录
2. 运行：

```powershell
node server.js
```

3. 打开：

```text
http://localhost:3000
```

## 部署前建议

- 不要把真实邮箱授权码提交到 GitHub
- 建议使用环境变量配置 SMTP：
  - `SMTP_ENABLED`
  - `SMTP_HOST`
  - `SMTP_PORT`
  - `SMTP_SECURE`
  - `SMTP_USER`
  - `SMTP_PASS`
  - `SMTP_FROM`
  - `PUBLIC_BASE_URL`

## 说明

项目的数据文件默认在 `data/` 目录下。
