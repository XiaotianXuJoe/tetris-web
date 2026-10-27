# 方块对照实验俄罗斯方块（tetris-web）

ADHD 干预研究的主动对照组实验工具：外观是俄罗斯方块，实质是低认知负荷的操作反应数据采集器（无分数、无等级、无 Game Over）。网页端，手机/电脑浏览器可用。

## 技术栈

- 前端 `web/`：React 19 + TypeScript + Vite 7 + Tailwind CSS v3.4 + shadcn/ui + recharts + SheetJS
- 后端 `server.js`：零依赖 Node.js（仅内置模块），静态服务 + `/api/*`（注册/登录/会话上报/后台管理/邮件提醒）
- 存储：`data.json`（生产环境文件，不在仓库中）

## 目录

- `web/` — 前端完整源码（构建产出 `web/dist/`）
- `server.js` — 服务端（静态 + API + SMTP 提醒，零依赖）
- `dist/` — 历史前端构建产物存档（最新构建见其中 hash 最新的 `index-*.js`）
- `docs/PRODUCTION.md` — 生产环境边界；`docs/HANDOVER.md` — 开发交接文档

## 检查 / 构建

```bash
node --check server.js          # 服务端语法检查
cd web && npm install && npm run build   # 前端构建
```

## 运行

```bash
ADMIN_USER=admin ADMIN_PASSWORD=<后台密码> SITE_URL=<游戏访问地址> node server.js   # 默认端口 8100
```

后台管理入口 `/admin`（游戏页面无入口链接）。`ADMIN_PASSWORD` 未设置时后台登录不可用。邮件提醒配置见 `email-config.example.json`（真实配置为服务器上的 `email-config.json`，不进仓库）。

本仓库只保存源码和文档，不保存生产密钥、用户数据或数据库。
