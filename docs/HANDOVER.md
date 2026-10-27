# 方块对照（俄罗斯方块）· ADHD 对照组实验游戏 — 开发交接文档

> 版本：v2.1（2026-10-26，游戏页左上角新增音效开关按钮（音量图标，默认开，偏好存 localStorage `tetris-adhd-muted`，静音时立即停止下落循环音并跳过所有播放；audio.ts `setMuted/isMuted`））
> 历史：v2.0 面板放满→整盘清空继续；音效「啾啾啾/哒啦/叮」；前台繁体化+姓氏繁简归一
> 用途：跨会话续作入口。新窗口中把本文档发给 Kimi 即可无缝继续开发。
> ⚠️ 本文档不含任何密码/密钥。服务器密码、微信后台凭据由用户本人保管，每次会话现用现给。

---

## 1. 项目定位

ADHD 干预研究中的**主动对照组**实验工具。外观是俄罗斯方块，实质是低认知负荷的操作反应数据采集器：

- 无分数、无等级、无消行计数、无 Game Over、无 BGM —— 刻意最小化游戏化激励与认知参与
- 采集的核心数据：每个方块是否落在算法推荐位置（Followed）、操作时间线（暂停/休息/会话起止）
- 最终交付形态：**网页端**（手机/电脑浏览器）。微信小程序版本已完成开发并通过申诉（认定研究工具非游戏），**但已决定不启用**，仅作为存档

---

## 2. 线上地址与部署

| 项 | 值 |
| --- | --- |
| 线上地址 | http://<CVM_IP>:8100/ |
| 服务器 | 腾讯云 CVM `<CVM_IP>`，用户 `ubuntu`（密码用户每次会话提供，勿写入文件） |
| 服务器目录 | `~/tetris-web/`（`server.js` + `dist/`） |
| 端口 | 8100（已避开浏览器不安全端口黑名单；腾讯云安全组已放行） |
| 进程管理 | `setsid nohup env PORT=8100 node tetris-web/server.js > ~/tetris-web/server.log 2>&1 &` |
| 静态服务 | 零依赖 Node `server.js`：路径白名单（`/.env`、`/server.js` 等一律 404）、HTML `Cache-Control: no-cache`、`/assets/*` 一年长缓存、SPA fallback |
| 后端 API | v1.1 起 `server.js` 内置 `/api/*`（注册/登录/会话上报/后台管理），仍零依赖；数据库为 `~/tetris-web/data.json`（dist 之外，静态服务不可访问，原子写入）。v1.2 新增：`PUT /api/user/profile`（用户改自己资料，编号不可自助改）、`PUT /api/admin/users/:id`（admin 改任意字段含编号，级联 sessions/tokens 登录态不断）、`DELETE /api/admin/users/:id`（连会话一并删除）。v1.8 新增：`GET /api/admin/users/:id/daily`（按北京时间 UTC+8 日期聚合该用户会话，days 升序，每日含 block1/2/3Seconds（null 计 0）、totalSeconds（复用 effectiveDurationSec 口径）、sessionCount、followed/followedTotal，数值 round 0.1s；sessionStart 非法时以 receivedAt 兜底）。v1.9 新增：`GET /api/admin/daily`（全部用户的同一聚合，聚合逻辑抽为 `dailyDays(data, pid)` 两路由共用；注意新 admin 路由需加入约 748 行的鉴权路径白名单，否则 404） |
| 后台管理 | **http://<CVM_IP>:8100/admin**（游戏页面无任何入口链接）；账号密码见服务器环境变量 ADMIN_USER/ADMIN_PASSWORD |

**一键部署**（v1.1 起）：

```bash
cd /mnt/agents/output/tetris-web-deploy
SSH_PASS='<服务器密码>' bash deploy.sh
# 自动完成：打包 server.js+dist → 上传 → 备份重启 → 健康检查
# 注意：tar 包不含 data.json，部署不会覆盖线上已有用户数据
```

**更新部署流程**（沙箱侧）：

```bash
cd /mnt/agents/output/app
# 沙箱会丢 node_modules，先恢复：
cp -r /app/.agents/skills/webapp-building-swarm/scripts/template/node_modules ./node_modules
npm run build
cp -r dist /mnt/agents/output/tetris-web-deploy/dist
cd /mnt/agents/output/tetris-web-deploy && tar czf /tmp/tetris-web.tar.gz server.js dist
sshpass -p '<密码>' scp -o StrictHostKeyChecking=no /tmp/tetris-web.tar.gz ubuntu@<CVM_IP>:~/
sshpass -p '<密码>' ssh -o StrictHostKeyChecking=no ubuntu@<CVM_IP> '
  cd ~ && cp -r tetris-web tetris-web.bak$(date +%s) &&
  tar xzf tetris-web.tar.gz -C tetris-web &&
  kill $(ps aux | grep "tetris-web/server.js" | grep -v grep | awk "{print \$2}") 2>/dev/null;
  sleep 1 && (setsid nohup env PORT=8100 node tetris-web/server.js > ~/tetris-web/server.log 2>&1 </dev/null &) &&
  sleep 2 && curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8100/'
```

部署后验证清单：公网 `curl` 首页 200 + title；`/.env`、`/server.js`、`/server.log` 均 404；`Cache-Control: no-cache`；headless chromium `--dump-dom` 能看到「开始游戏」。

---

## 3. 代码位置（沙箱侧权威源码）

| 内容 | 路径 |
| --- | --- |
| 网页端源码 | `/mnt/agents/output/app/`（React 19 + TS + Vite 7 + Tailwind v3.4.19，主文件 `src/pages/Home.tsx`） |
| 登录/注册页 | `app/src/pages/Auth.tsx`（强制登录门；登录=三个输入框「被試編號 / 再次輸入編號 / **兒童姓氏**」，前端校验两次编号一致后拼 credential=编号+儿童姓 提交，无密码；**v1.5 注册 tab 已隐藏**，注册代码以注释保留（注意：其中 parentSurname 字段已过时，恢复前需改为 childName 新 schema），`POST /api/register` 后端接口仍可用。**v2.0 前台全部文案繁体化**（Auth+Home+index.html title/lang=zh-Hant；后台管理页保持简体）；登录前 `normalizeSurname()` 把繁体姓氏归一为简体再提交（常见单字姓 44 个+复姓 14 个映射），避免孩子按繁体提示输入导致登录失败）
| 用户 schema | v1.6 起：`{ participantId, childSurname, childGivenName, childName, childAge, childGender, email, registeredAt }`；不再记录家长姓氏；儿童姓名服务端拆分（`splitChineseName`：74 个常见复姓优先匹配，否则首字为姓）；老记录懒迁移（childName 拆分补齐）；单字名无法迁移（登录不命中，需管理员在后台编辑补姓/名） |
| 批量导入 | v1.6：后台「批量导入」按钮上传 .xlsx（列：ID编号/儿童姓名/儿童年龄/儿童性别/联系邮箱）；前端 SheetJS 解析（编号保前导零，数字自动 padStart(4)）→ 预览 → `POST /api/admin/import-users` 逐行校验（合法行导入、失败行报告行号+原因）；复姓拆分在服务端统一完成 |
| 邮件提醒 | v1.7：3 天未上线（lastPlayedAt 或注册时间 ≥72h）且 72h 内未提醒过 → 发提醒邮件。零依赖 SMTP-over-TLS 客户端（server.js 内）；配置在服务器 `~/tetris-web/email-config.json`（host/port/user/pass/fromName，不打入部署包、404 不可访问）；自动每天北京时间 09:00-09:29 发送（内存+data.json 双标记防重发，1s/封）；手动 `POST /api/admin/send-reminders`；后台用户表有「未上线」（≥3天琥珀标色）「上次提醒」列 + 「发送提醒」按钮；未配置时接口返回 503「邮件服务未配置」 |
| 用户端改资料 | v1.2 曾加、**v1.4 已移除**「修改信息」按钮与弹窗（profile-btn/modal 样式已清理）；后端 `PUT /api/user/profile` 保留可用；管理员端编辑/删除用户保留 |
| 后台管理页 | `app/src/pages/Admin.tsx`（`/admin` 路由：概览卡片、用户表格、会话明细、Followed 比率、JSON 详情、双 CSV 导出；v1.2 每行加「编辑」（编号可改）/「删除」（确认弹窗，连游玩记录一并删）；v1.5 排版美化：nowrap 防折行、按钮横向 pill、卡片基线对齐；v1.7.1 宽屏自适应：容器 max-w-1600px、时间列短格式、邮箱 truncate、操作列 sticky right-0、全局 8px 细滚动条；v1.8 操作列加「详情」按钮（BarChart3 图标）→ DailyModal（max-w-3xl）：recharts 堆叠柱状图（三轮 stackId 共享，配色 #a9becb/#d3afaf/#b7c4a9，X=MM/DD，Y=分钟）+ 六列表格（日期/第1-3轮/总时长/次数，末尾加粗合计行）+ 空态/加载态；api.ts 新增 DailyRow 类型与 getUserDaily()；v1.9 顶栏加「导出每日详情 Excel」按钮：getAllUsersDaily() 拉全量聚合 → 前端 SheetJS 动态 import 生成单 sheet「每日游玩详情」xlsx（列：编号/儿童姓/儿童名/日期/第1-3轮(秒)/总时长(秒)/游玩次数/方块总数/推荐位置数/推荐比例(%)，编号与日期强制文本格式保留前导零，时长为数值秒 0.1 精度）） |
| 邮件配置 | 服务器 `~/tetris-web/email-config.json` 已配置 QQ 邮箱 SMTP（<QQ邮箱>，465 端口，2026-10-12 测试邮件送达成功）；授权码仅存于该文件（权限 600），不在任何代码/文档中 |
| 用户端按钮 | `Home.tsx` 左上角两个低调按钮：「暂停」「退出登录」（v1.4 起） |
| API 客户端 | `app/src/api.ts`（token 存 localStorage `tetris-adhd-auth` / 管理员 `tetris-adhd-admin`；失败上报队列 `tetris-adhd-pending-upload`） |
| 游戏逻辑 | `/mnt/agents/output/app/src/game/`：`engine.ts`（网格/推荐算法）、`pieces.ts`（7 方块+莫兰迪色）、`audio.ts`（五声音阶 Web Audio）、`log.ts`（SessionLog） |
| 部署目录 | `/mnt/agents/output/tetris-web-deploy/`（`server.js` + 构建产物） |
| 小程序源码（存档） | `/mnt/agents/output/project/`（Taro 3.6.40 + React 18 + TS → weapp；含 `cloudfunctions/` 4 个云函数） |
| 小程序打包存档 | `/mnt/agents/output/tetris-miniprogram.zip` |
| 需求/设计文档 | `/mnt/agents/output/design/design.md`、`design/home.md`、`/mnt/agents/output/plan.md`、`/mnt/agents/output/SPEC.md`（小程序规格） |
| 本交接文档 | 本地 `/mnt/agents/output/方块对照-开发交接文档.md` + 服务器 `/home/ubuntu/方块对照_开发交接文档.md` 双份 |

---

## 4. 核心实验设计（改动前必读，这些是研究协议不是随意的产品决策）

### 4.1 棋盘与方块

- 10 列 × 20 行；7 种方块（O/I/L/J/T/S/Z）**不可旋转**，生成时随机横/竖朝向
- 方块从顶部居中生成；底部虚线轮廓显示算法推荐位置（`engine.ts` 的 `recommend`：最小化堆叠高度启发式），仅供参考

### 4.2 会话结构

- 游戏 6:00 → 休息 1:00（「请休息」遮罩，计时暂停、音频静音）→ 6:00 → 休息 → 6:00 → 永久「谢谢参与」结束遮罩
- 每轮结束**清空棋盘**，下一轮从空白棋盘开始；三轮唯一区别是下落速度
- 顶部 6 颗空心星，每累计 3:00 有效游戏时间点亮 1 颗

### 4.3 下落速度（固定常数，严禁改成动态）

- 满屏（20 行）下落耗时：Block 1/2/3 = **10s / 8s / 5s**（即 2 / 2.5 / 4 行每秒）
- 与玩家表现完全无关

### 4.4 无操作自动落位（最容易踩坑的功能，已迭代 4 轮定稿）

- 「无操作」= 距上次**点击屏幕/按方向键**的时间；阈值固定 = 当轮下落时间（10/8/5s）
- 计时器**跨方块持续**（方块落地/生成不重置，只有用户点击才重置）
- 双重触发条件：`idle >= 阈值` **且** 方块底边到达当前已落定方块的最高行
- 动画严格两段式：0.7s 水平滑向推荐列（y 冻结，不与已有方块重叠）→ 0.7s 直线下落锁定

### 4.5 操作

- 仅操作模式。点屏幕左半 = 左移一列，右半 = 右移一列（移动端优先）；桌面 ←/→ 保留
- ↓ 加速**禁用**
- 左上角低调「暂停」→ 回主界面（「继续游戏」全状态恢复 /「重新开始」），暂停起止记入日志；切后台自动暂停

### 4.6 视听

- 无 BGM；非推荐位落定播一个五声音阶钢琴音（C5 D5 E5 G5 A5 C6，邻音偏向随机游走，gain ≤ 0.12）
- v2.0 音效（`audio.ts` 程序化 Web Audio 合成，无音频文件）：**下落中循环「啾啾啾」**（正弦 1750→2650Hz 上滑三连音，每 1.6s 一轮，`startFallingChirp` 幂等、phase/piece 变化自动启停）；**落到推荐位「哒啦」**（E5→A5 双音，替代普通落定音）；**消行「叮」**（C7 铃音+泛音 1.1s 衰减）
- 莫兰迪低饱和配色；背景 30s 灰蓝 ↔ 灰粉交叉渐变
- 消行：600ms 静默淡出 + 「叮」；**v2.0 起面板放满（堆叠进入顶部 6 行，或新方块无法生成）→ 整个面板 620ms 渐隐清空，从空面板继续游戏**（本轮计时不中断，直到满 6 分钟；取代了旧的「0–5 行静默淡出」防顶出机制，无 Game Over）

### 4.7 数据日志（SessionLog，`src/game/log.ts`）

- `Time`：sessionStart / rests / pauses / sessionEnd
- `Training`：各轮实际秒数
- `Followed`：逐方块 ghostCol vs lockedCol + 汇总
- `speedSetting`：固定梯度说明 + [10,8,5]
- 网页端：localStorage 持久 + 结束遮罩上「导出 JSON」按钮
- v1.1 起自动上报后端 `POST /api/session`：会话结束（Block3 完成）、「重新开始」前（旧日志有实质内容时）、pagehide/切后台 best-effort（fetch keepalive）；失败入待传队列联网重试；同一用户相同 sessionStart 服务端 upsert 去重；401 自动回登录页
- v1.3 统计口径（用户确认）：**游玩时长 = 各轮活跃秒数之和**（进入游戏即计时，休息/暂停不计入；中途退出当前轮按已进行秒数记入，`log.ts recordBlockPartial`）；服务端 `computeActiveSeconds` 实时重算，历史数据自动按新口径显示；**方块统计** = Followed.total（总下落）/ Followed.followed（落在推荐位）/ 比例，后台按用户汇总 + 每会话两级展示，users.csv 含对应三列
- （小程序版另有 sessionId/complete/checkpointReason 增量上报字段，见 §6）

---

## 5. 网页端迭代历史（排障参考）

1. 初版按需求文档实现；平台版本卡片不显示 → 根因 `dist` 被 gitignore 未提交，已修复（`git add -f dist`）
2. 速度曾做成可调 → 按用户要求改固定梯度 15s → 10/8/5s（语义：满屏下落总耗时，非每行秒数）
3. 观看/操作双模式 → 合并为仅操作模式，方块居中生成 + 推荐虚线保留
4. 键盘操作 → 屏幕左右点击（手机适配），桌面方向键保留
5. 自动落位不触发 → 根因：下落太快，方块自然落地时间（9.5/7.6/4.75s）早于 10s 阈值 → 经 4 轮需求迭代定为 §4.4 的双重条件语义
6. 滑行动画重叠 → 改先平移后下落两段式
7. v1.8 部署坑：服务器旧进程命令行为 `node tetris-web/server.js`（含路径），`grep "[n]ode server.js"` 匹配不到导致旧进程存活、新进程 EADDRINUSE → 杀进程需用 `grep "[t]etris-web"` 或按端口 `ss -tlnp | grep 8100` 找 PID；服务器上还跑着其他项目（kline-master 等）的 node 进程，勿误杀
8. v2.0 起防顶出机制变更：旧版「堆叠到顶部时 0–5 行静默淡出」已删除（checkTopOut 移除），替换为整盘清空（checkBoardFull，阈值 row<6）；若实验需要恢复旧机制，从 v1.9 存档包回滚 Home.tsx 即可
9. 沙箱每次会话会清 /tmp、apt 包、node_modules → sshpass 要重装、xlsx 要补装（npmmirror）、node_modules 从 webapp-building-swarm template 拷贝

---

## 6. 微信小程序版（已完成开发，存档不启用）

- AppID `wx2a6c32f6267d3919`（类目「其他」，个人主体，名「方块对照」）；曾误判游戏类目，**申诉成功**（理由：无分数/等级/激励的 ADHD 研究测量工具）
- 云开发环境 `cloudbase-d1g8m1p8u7447efff`：4 云函数（login / saveSession / getSessions / dailyReminder）+ 3 集合（users / sessions / reminders，仅创建者可读写）+ dailyReminder 定时触发器 `0 0 1 * * * *`（北京时间 09:00，检查 3 天未活跃→订阅消息提醒家长）
- 功能全通：家长免授权登录、增量日志上报（sessionId upsert，complete/checkpointReason 区分完整度）、断网 pending 重传、3 天未玩提醒（订阅消息模板 ID 未申请，`REMIND_TEMPLATE_ID` 仍是占位）
- 已发布线上版 0.2.0；备案未办（deadline 2026-12-27，不启用小程序则无需处理）
- 另注册过小游戏账号 `wx6f57a236bdd2bdcc`（不需要，可忽略）
- 关键坑：Taro 3.6.40 的 webpackbar@5.0.2 与 webpack 5.111 不兼容 → `package.json` 用 `"overrides": {"webpack": "5.91.0"}` + 随包发 `package-lock.json`；国内 npm 用 `registry.npmmirror.com`；云函数更新用「上传并部署」（非「创建并部署」）

---

## 7. 已知待办 / 后续方向

- [x] ~~网页端会话日志集中收集后端~~（v1.1 完成：`/api/*` + data.json，零依赖复用 8100）
- [x] ~~网页端家长登录~~（v1.1 完成：编号+姓氏免密码登录 + 后台管理系统 /admin）
- [ ] 实验组游戏（需求文档下半部分：跳跃游戏 + 剧情动画 + 水晶收集 + 熊猫伙伴）**尚未开始**，是下一阶段大项
- [ ] admin 凭据从环境变量 ADMIN_USER/ADMIN_PASSWORD 读取（GitHub 公开仓库版不再硬编码，真实值只在服务器环境变量）

---

## 8. 新窗口续作开场白模板

> 请阅读我上传的《方块对照-开发交接文档.md》，这是一个 ADHD 对照组实验用的俄罗斯方块网页游戏，已部署在 http://<CVM_IP>:8100/。网页端源码在 /mnt/agents/output/app，我现在想要：<你的新需求>