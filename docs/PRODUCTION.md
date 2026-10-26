# 生产环境边界

- 项目：方块对照实验俄罗斯方块
- 端口：8100
- 目录：/home/ubuntu/tetris-web
- 进程：PM2：tetris-web

## 推荐检查

`服务端 node --check server.js；当前无前端源码构建命令`

## 不上传、不覆盖

data.json、email-config.json 和日志。这些内容只应通过独立的生产备份机制保存，不属于 Git 源码。

本仓库公开可见。任何真实凭据都不应写入代码、Issue、Actions 日志或 Git 历史。
