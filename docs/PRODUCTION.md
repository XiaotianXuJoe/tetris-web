# 生产环境边界

- 项目：方块对照实验俄罗斯方块
- 端口：8100
- 目录：/home/ubuntu/tetris-web（server.js + dist/ + data.json + email-config.json）
- 进程：`nohup node server.js > server.log 2>&1 &`；重启前按端口找 PID（`ss -tlnp | grep 8100`），勿误杀同机其他项目
- 环境变量：`ADMIN_USER` / `ADMIN_PASSWORD`（后台登录凭据，未设置则后台不可用）；`SITE_URL`（提醒邮件正文中的游戏访问地址，未设置时邮件中显示占位文字）；`PORT`（默认 8100）

## 推荐检查

- 服务端 `node --check server.js`
- 前端 `cd web && npm install && npm run build`
- 部署后健康检查：首页 200；`/data.json`、`/.env`、`/email-config.json`、`/server.js` 均 404

## 不上传、不覆盖

data.json（用户与会话数据）、email-config.json（邮箱 SMTP 授权码）、.env、server.log、备份目录（tetris-web.bak-*）。这些内容只应通过独立的生产备份机制保存，不属于 Git 源码。

本仓库公开可见。任何真实凭据都不应写入代码、Issue、Actions 日志或 Git 历史。
