# Agent 维护说明

## 项目

- 名称：方块对照实验俄罗斯方块
- 技术栈：React 19 + TS + Vite 7（前端 `web/`）+ 零依赖 Node.js 服务端（`server.js`）
- 生产端口：8100
- 服务器目录：/home/ubuntu/tetris-web
- 运行方式：`nohup node server.js > server.log 2>&1 &`（按端口 `ss -tlnp | grep 8100` 找 PID 重启；服务器上有其他项目的 node 进程，勿误杀）
- 检查／构建：`node --check server.js`；前端 `cd web && npm install && npm run build`

## 维护约束

重要：实验常数不得擅改——BLOCK_LEN=360、REST_LEN=60、STAR_STEP=180、DESCENT_TIMES=[10,8,5]；面板放满→整盘清空继续（v2.0 起）；会话结构与自动落位规则不得擅自改变。

- GitHub 是源码权威；生产服务器只保留运行环境、密钥和业务数据。
- 管理员凭据从环境变量 `ADMIN_USER` / `ADMIN_PASSWORD` 读取，真实值只在服务器上。
- 不得把真实配置、密码、API Key、Cookie、用户数据、数据库、上传文件或日志提交到本公开仓库。
- 不得为了调试而放开静态文件、代理或管理接口的访问控制。
- 不要直接在服务器生产目录手工改代码后不回写仓库。

## 不得进入仓库的运行内容

data.json、email-config.json、.env 和日志。

详细生产边界见 `docs/PRODUCTION.md`；完整迭代历史与踩坑记录见 `docs/HANDOVER.md`。如文档冲突，先确认现状再操作。
