# web/ — 前端源码（React 19 + TypeScript + Vite 7 + Tailwind v3.4）

ADHD 对照组实验「方块对照」网页游戏前端。页面：登录门（编号+儿童姓氏）、游戏页（3×6 分钟 + 2×1 分钟休息）、后台管理页 `/admin`。

```bash
npm install        # 恢复依赖（xlsx 需单独装：npm i xlsx@0.18.5）
npm run build      # 产出 dist/
npm run lint       # 代码检查
```

实验常数（`src/pages/Home.tsx`，不得擅改）：BLOCK_LEN=360、REST_LEN=60、STAR_STEP=180、DESCENT_TIMES=[10,8,5]。
