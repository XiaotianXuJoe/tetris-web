/**
 * 方块对照（ADHD 对照组实验游戏）静态服务器 + 实验数据后端
 * 零依赖 Node HTTP 服务：托管 dist/ 构建产物，并提供 /api/* 数据接口
 * - 路径白名单：只服务 dist/ 目录内文件，server.js / .env / data.json 等一律 404
 * - index.html：Cache-Control no-cache；/assets/* 哈希资源：长缓存
 * - SPA fallback：未知路径回退 index.html
 * - /api/* 路由先于静态文件匹配；数据持久化在 dist 之外的 data.json（原子写入）
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const tls = require('tls')

const PORT = Number(process.env.PORT || 8100)
const ROOT = path.join(__dirname, 'dist')
const DATA_FILE = path.join(__dirname, 'data.json')
// 发件邮箱配置（dist 之外，静态白名单天然 404，不会被打入部署包）
const EMAIL_CONFIG_FILE = path.join(__dirname, 'email-config.json')
const BODY_LIMIT = 5 * 1024 * 1024 // 5MB
const REMINDER_INTERVAL_MS = 72 * 3600 * 1000 // 3 天未上线 / 距上次提醒的最小间隔
const SMTP_TIMEOUT_MS = 15 * 1000 // 单封邮件超时

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

/* ---------------- 数据持久化（JSON 文件，原子写入） ---------------- */

function emptyData() {
  return { users: {}, sessions: {}, userTokens: {}, adminTokens: {}, lastAutoReminderDate: null }
}

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8')
    const d = JSON.parse(raw)
    const data = {
      users: d.users && typeof d.users === 'object' ? d.users : {},
      sessions: d.sessions && typeof d.sessions === 'object' ? d.sessions : {},
      userTokens: d.userTokens && typeof d.userTokens === 'object' ? d.userTokens : {},
      adminTokens: d.adminTokens && typeof d.adminTokens === 'object' ? d.adminTokens : {},
      // 自动提醒「今天已发过」双保险之一（另一个是内存标记），重启后也不重复发送
      lastAutoReminderDate: typeof d.lastAutoReminderDate === 'string' ? d.lastAutoReminderDate : null,
    }
    // 懒迁移：老记录缺 childSurname 但有 childName 时，拆分补齐新字段并写回；
    // 拆分失败则按「第 1 字作姓、其余作名」兜底；仍不行（如单字名）保持原样，
    // 该用户登录匹配自然不命中，但不影响服务运行
    let migrated = false
    for (const u of Object.values(data.users)) {
      if (!u || typeof u !== 'object') continue
      if (u.childSurname || !u.childName) continue
      const parts = splitChineseName(u.childName) || splitChineseNameFallback(u.childName)
      if (!parts) continue
      u.childSurname = parts.surname
      u.childGivenName = parts.given
      if (u.childAge === undefined) u.childAge = null
      migrated = true
    }
    if (migrated) saveData(data)
    return data
  } catch {
    return emptyData()
  }
}

function saveData(data) {
  const tmp = DATA_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, DATA_FILE) // 原子替换，避免半写状态
}

/* ---------------- 工具函数 ---------------- */

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let aborted = false
    req.on('data', (c) => {
      if (aborted) return
      size += c.length
      if (size > BODY_LIMIT) {
        aborted = true
        reject(httpError(413, '请求体过大（超过 5MB）'))
        return // 继续排空数据但不缓冲，保证 413 响应能正常发出
      }
      chunks.push(c)
    })
    req.on('end', () => { if (!aborted) resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', (e) => { if (!aborted) reject(e) })
  })
}

async function readJsonBody(req) {
  const text = await readBody(req)
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw httpError(400, '请求体不是有效的 JSON')
  }
}

function bearerToken(req) {
  const h = req.headers['authorization'] || ''
  const m = /^Bearer\s+(.+)$/i.exec(h)
  return m ? m[1].trim() : null
}

function newToken() {
  return crypto.randomBytes(24).toString('hex')
}

/* ---------------- 中文姓名拆分与字段校验 ---------------- */

// 常见复姓表（用于拆分全名时优先匹配前 2 字）
const COMPOUND_SURNAMES = new Set([
  '欧阳', '司马', '诸葛', '上官', '夏侯', '皇甫', '尉迟', '公孙', '令狐', '宇文',
  '长孙', '慕容', '司徒', '鲜于', '闾丘', '子车', '亓官', '司寇', '巫马', '公西',
  '颛孙', '壤驷', '公良', '漆雕', '乐正', '宰父', '谷梁', '拓跋', '夹谷', '轩辕',
  '百里', '呼延', '东郭', '南门', '羊舌', '微生', '梁丘', '左丘', '西门', '第五',
  '公羊', '公冶', '太叔', '申屠', '濮阳', '单于', '完颜', '耶律', '赫连', '独孤',
  '万俟', '闻人', '宗政', '公户', '公玉', '公仪', '公仲', '公上', '公门', '公山',
  '公坚', '公伯', '公祖', '公乘', '贯丘', '公皙', '南荣', '东里', '东宫', '仲长',
  '子书', '子桑', '即墨', '达奚', '褚师',
])

/**
 * 拆分中文全名：前 2 字命中复姓表则姓=前2字，否则姓=第1字，名=剩余部分。
 * 全名不足 2 字或拆分后名为空时返回 null（视为非法）。
 */
function splitChineseName(fullName) {
  const name = String(fullName ?? '').trim()
  if (name.length < 2) return null
  let surname
  let given
  const first2 = name.slice(0, 2)
  if (COMPOUND_SURNAMES.has(first2)) {
    surname = first2
    given = name.slice(2)
  } else {
    surname = name.slice(0, 1)
    given = name.slice(1)
  }
  if (!given) return null
  return { surname, given }
}

/** 兜底拆分：第 1 字作姓、其余作名（用于懒迁移中 splitChineseName 失败的记录） */
function splitChineseNameFallback(fullName) {
  const name = String(fullName ?? '').trim()
  if (name.length < 2) return null
  return { surname: name.slice(0, 1), given: name.slice(1) }
}

/** 校验 childAge：未提供（undefined/null/''）→ null；否则须为 0~18 的数字 */
function normalizeChildAge(v) {
  if (v === undefined || v === null || v === '') return { ok: true, value: null }
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 18) return { ok: false }
  return { ok: true, value: n }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function publicUser(u) {
  return {
    participantId: u.participantId,
    childSurname: u.childSurname,
    childGivenName: u.childGivenName,
    childName: u.childName,
    childAge: u.childAge ?? null,
    childGender: u.childGender,
    email: u.email,
    registeredAt: u.registeredAt,
  }
}

function authUser(req, data) {
  const t = bearerToken(req)
  const pid = t ? data.userTokens[t] : null
  return pid && data.users[pid] ? pid : null
}

function authAdmin(req, data) {
  const t = bearerToken(req)
  return t && data.adminTokens[t] ? true : false
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * 计算活跃游戏秒数（不含休息与暂停）。
 * 优先：Training.block1/2/3Seconds 中非 null 值求和，四舍五入到 0.1s；
 * 兜底：sessionEnd-sessionStart 减去 rests/pauses 时长（end 为 null 的区间用
 * sessionEnd 或当前时间封口），结果为负则 0；sessionStart/sessionEnd 缺失或非法则 null。
 */
function computeActiveSeconds(log) {
  if (!log || typeof log !== 'object') return null
  const training = log.Training && typeof log.Training === 'object' ? log.Training : {}
  const blockVals = ['block1Seconds', 'block2Seconds', 'block3Seconds']
    .map((k) => training[k])
    .filter((v) => v !== null && v !== undefined && Number.isFinite(Number(v)))
  if (blockVals.length > 0) {
    return Math.round(blockVals.reduce((a, v) => a + Number(v), 0) * 10) / 10
  }

  const time = log.Time && typeof log.Time === 'object' ? log.Time : {}
  const startMs = Date.parse(time.sessionStart)
  const endMs = Date.parse(time.sessionEnd)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null

  let activeMs = endMs - startMs
  const subtractIntervals = (list) => {
    if (!Array.isArray(list)) return
    for (const iv of list) {
      if (!iv || typeof iv !== 'object') continue
      const s = Date.parse(iv.start)
      if (!Number.isFinite(s)) continue
      let e = Date.parse(iv.end)
      if (!Number.isFinite(e)) e = Number.isFinite(endMs) ? endMs : Date.now() // 未封口区间：用 sessionEnd，否则当前时间
      if (e > s) activeMs -= e - s
    }
  }
  subtractIntervals(time.rests)
  subtractIntervals(time.pauses)
  if (activeMs < 0) activeMs = 0
  return Math.round(activeMs / 100) / 10
}

/** admin 读取口径：记录含完整 log 时实时重算活跃秒数，否则用存储值兜底 */
function effectiveDurationSec(s) {
  if (s && s.log && typeof s.log === 'object') {
    const v = computeActiveSeconds(s.log)
    if (v != null) return v
  }
  return num(s && s.durationSec)
}

/** 取会话 Followed 原始计数：优先 log.Followed，缺失时用存储的汇总字段兜底（兼容历史记录） */
function followedCounts(s) {
  const f = s && s.log && s.log.Followed && typeof s.log.Followed === 'object' ? s.log.Followed : null
  return {
    followed: f && Number.isFinite(Number(f.followed)) ? Number(f.followed) : num(s && s.followed),
    total: f && Number.isFinite(Number(f.total)) ? Number(f.total) : num(s && s.followedTotal),
  }
}

/** 按北京时间（UTC+8）日期聚合某用户的每日游玩时长；sessionStart 非法时以 receivedAt 兜底，数值 round 0.1s，days 按日期升序 */
function dailyDays(data, pid) {
  const round1 = (v) => Math.round(v * 10) / 10
  const byDay = new Map()
  for (const s of Object.values(data.sessions)) {
    if (s.participantId !== pid) continue
    const time = s.log && s.log.Time && typeof s.log.Time === 'object' ? s.log.Time : {}
    let startMs = Date.parse(time.sessionStart)
    if (!Number.isFinite(startMs)) startMs = Date.parse(s.receivedAt)
    if (!Number.isFinite(startMs)) continue
    const date = beijingParts(startMs).date
    let day = byDay.get(date)
    if (!day) {
      day = { date, block1Seconds: 0, block2Seconds: 0, block3Seconds: 0, totalSeconds: 0, sessionCount: 0, followed: 0, followedTotal: 0 }
      byDay.set(date, day)
    }
    const training = s.log && s.log.Training && typeof s.log.Training === 'object' ? s.log.Training : {}
    day.block1Seconds += num(training.block1Seconds) // null/缺失当 0
    day.block2Seconds += num(training.block2Seconds)
    day.block3Seconds += num(training.block3Seconds)
    day.totalSeconds += effectiveDurationSec(s) // 与 admin 其他口径一致：含 log 实时重算，否则存储值兜底
    day.sessionCount += 1
    const fc = followedCounts(s)
    day.followed += fc.followed
    day.followedTotal += fc.total
  }
  return [...byDay.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      date: d.date,
      block1Seconds: round1(d.block1Seconds),
      block2Seconds: round1(d.block2Seconds),
      block3Seconds: round1(d.block3Seconds),
      totalSeconds: round1(d.totalSeconds),
      sessionCount: d.sessionCount,
      followed: round1(d.followed),
      followedTotal: round1(d.followedTotal),
    }))
}

/** 根据 SessionLog 计算服务端汇总字段 */
function summarizeLog(log) {
  const time = log && log.Time && typeof log.Time === 'object' ? log.Time : {}
  const sessionStart = typeof time.sessionStart === 'string' ? time.sessionStart : ''
  const sessionEnd = typeof time.sessionEnd === 'string' ? time.sessionEnd : ''

  const active = computeActiveSeconds(log)
  const durationSec = active != null ? active : 0

  const followed = log && log.Followed && typeof log.Followed === 'object' ? log.Followed : {}
  return {
    sessionStart,
    durationSec,
    followed: num(followed.followed),
    followedTotal: num(followed.total),
    completed: Boolean(sessionEnd && sessionEnd.trim()),
  }
}

function sessionIdFor(participantId, sessionStart) {
  if (!sessionStart) return crypto.randomBytes(12).toString('hex')
  return crypto.createHash('sha1').update(`${participantId}|${sessionStart}`).digest('hex').slice(0, 16)
}

function sessionSummary(s) {
  return {
    sessionId: s.sessionId,
    participantId: s.participantId,
    sessionStart: s.sessionStart,
    durationSec: effectiveDurationSec(s), // 含完整 log 时实时重算活跃秒数
    followed: s.followed,
    followedTotal: s.followedTotal,
    completed: s.completed,
    receivedAt: s.receivedAt,
  }
}

function userStats(data, participantId) {
  const list = Object.values(data.sessions).filter((s) => s.participantId === participantId)
  let totalPlaySeconds = 0
  let totalPieces = 0
  let totalFollowed = 0
  let lastPlayedAt = ''
  for (const s of list) {
    totalPlaySeconds += effectiveDurationSec(s)
    const fc = followedCounts(s)
    totalPieces += fc.total
    totalFollowed += fc.followed
    const cand = s.sessionStart || s.receivedAt || ''
    if (cand && cand > lastPlayedAt) lastPlayedAt = cand
  }
  const followedRate = totalPieces > 0 ? Math.round((totalFollowed / totalPieces) * 10000) / 10000 : null
  return { sessionCount: list.length, totalPlaySeconds, lastPlayedAt, totalPieces, totalFollowed, followedRate }
}

function csvCell(v) {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

function sendCsv(res, filename, header, rows) {
  const csv = '\ufeff' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n' // 前缀 UTF-8 BOM，方便 Excel 识别
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  })
  res.end(csv)
}

/* ---------------- 邮件提醒：配置加载 + 零依赖 SMTP-over-TLS 客户端 ---------------- */

/**
 * 读取 email-config.json：{ host, port, user, pass, fromName }
 * 文件不存在 / JSON 非法 / 必填字段缺失 → 返回 null（未配置状态）；
 * 未配置时提醒相关接口返回 503，其余功能不受影响。
 */
function loadEmailConfig() {
  try {
    const raw = fs.readFileSync(EMAIL_CONFIG_FILE, 'utf8')
    const c = JSON.parse(raw)
    const host = String(c.host || '').trim()
    const port = Number(c.port)
    const user = String(c.user || '').trim()
    const pass = String(c.pass || '')
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535 || !user || !pass) return null
    return { host, port, user, pass, fromName: String(c.fromName || '方块对照实验组').trim() || '方块对照实验组' }
  } catch {
    return null
  }
}

function b64utf8(s) {
  return Buffer.from(String(s), 'utf8').toString('base64')
}

/** RFC 2047 encoded-word：邮件头中的中文（From 显示名 / Subject）用 UTF-8 Base64 编码 */
function encodeHeaderWord(s) {
  return '=?UTF-8?B?' + b64utf8(String(s).replace(/[\r\n]+/g, ' ')) + '?='
}

/**
 * 组装 RFC 5322 邮件原文：
 * - 头部 CRLF 分隔；正文统一 CRLF；以点号开头的行按 SMTP 规范转义为两个点
 */
function buildMailMessage(cfg, { to, subject, text }) {
  const cleanTo = String(to).replace(/[\r\n]+/g, '')
  const headers = [
    `From: ${encodeHeaderWord(cfg.fromName)} <${cfg.user}>`,
    `To: <${cleanTo}>`,
    `Subject: ${encodeHeaderWord(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${crypto.randomBytes(8).toString('hex')}@tetris-web>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
  ]
  const body = String(text)
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n') // 统一 CRLF
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? '.' + line : line)) // 点号行转义
    .join('\r\n')
  return headers.join('\r\n') + '\r\n\r\n' + body
}

/**
 * 零依赖 SMTP-over-TLS 客户端（Node 内置 tls）：
 * tls.connect → 220 greeting → EHLO → AUTH LOGIN（base64 分步）→
 * MAIL FROM → RCPT TO → DATA → 正文 + \r\n.\r\n → QUIT。
 * 正确解析多行响应（250-xxx 续行，250 结束）；4xx/5xx 抛带中文说明的错误；单封 15s 超时。
 */
function sendMail(cfg, { to, subject, text }) {
  return new Promise((resolve, reject) => {
    let settled = false
    let buf = ''
    let curLines = []
    const waiters = [] // 响应等待队列：每个 SMTP 命令对应一个
    const sock = tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host })
    sock.setEncoding('utf8')
    sock.setTimeout(SMTP_TIMEOUT_MS)

    const fail = (err) => {
      if (settled) return
      settled = true
      try { sock.destroy() } catch { /* ignore */ }
      reject(err instanceof Error ? err : new Error(String(err)))
    }
    sock.on('timeout', () => fail(new Error('SMTP 连接超时（15 秒无响应）')))
    sock.on('error', (e) => fail(new Error(`SMTP 连接失败（${cfg.host}:${cfg.port}）：${e.message || e}`)))
    sock.on('close', () => {
      if (!settled && waiters.length > 0) fail(new Error('SMTP 连接被服务器意外关闭'))
    })
    sock.on('data', (chunk) => {
      buf += chunk
      let idx
      while ((idx = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        // 多行响应：250-xxx 为续行，250 xxx（空格）为最后一行
        const m = /^(\d{3})([ -])/.exec(line)
        if (!m) continue
        curLines.push(line)
        if (m[2] === '-') continue
        const w = waiters.shift()
        if (w) w({ code: Number(m[1]), lines: curLines })
        curLines = []
      }
    })

    /** 等待下一条完整响应；code 不在 okCodes 内（如 4xx/5xx）则抛带中文说明的错误 */
    const nextResponse = (okCodes, errMsg) => new Promise((res, rej) => {
      waiters.push((resp) => {
        if (okCodes.includes(resp.code)) res(resp)
        else rej(new Error(`${errMsg}（服务器返回：${resp.lines[resp.lines.length - 1]}）`))
      })
    })

    ;(async () => {
      const authErr = 'SMTP 认证失败，请检查授权码'
      await nextResponse([220], 'SMTP 服务握手失败') // greeting
      sock.write('EHLO tetris-web\r\n')
      await nextResponse([250], 'SMTP EHLO 失败')
      sock.write('AUTH LOGIN\r\n')
      await nextResponse([334], authErr)
      sock.write(b64utf8(cfg.user) + '\r\n')
      await nextResponse([334], authErr)
      sock.write(b64utf8(cfg.pass) + '\r\n')
      await nextResponse([235], authErr)
      sock.write(`MAIL FROM:<${cfg.user}>\r\n`)
      await nextResponse([250], 'SMTP 发件地址被拒绝')
      sock.write(`RCPT TO:<${String(to).replace(/[\r\n]+/g, '')}>\r\n`)
      await nextResponse([250, 251], 'SMTP 收件地址被拒绝')
      sock.write('DATA\r\n')
      await nextResponse([354], 'SMTP 数据传输被拒绝')
      sock.write(buildMailMessage(cfg, { to, subject, text }) + '\r\n.\r\n')
      await nextResponse([250], 'SMTP 邮件发送被拒')
      sock.write('QUIT\r\n')
      settled = true
      sock.end()
      resolve()
    })().catch(fail)
  })
}

/* ---------------- 邮件提醒：判定、模板与自动定时 ---------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 单用户提醒判定信息：
 * - daysInactive：距今(now - (lastPlayedAt || registeredAt)) 的整数天数（floor）
 * - needsReminder：未活跃 >= 72h，且（从未提醒过 或 距上次提醒 >= 72h）
 */
function reminderInfo(data, u, nowMs) {
  const stats = userStats(data, u.participantId)
  const refMs = Date.parse(stats.lastPlayedAt || u.registeredAt || '')
  const daysInactive = Number.isFinite(refMs) ? Math.max(0, Math.floor((nowMs - refMs) / 86400000)) : 0
  const lastRemMs = Date.parse(u.lastReminderAt || '')
  const needsReminder = Number.isFinite(refMs) &&
    (nowMs - refMs) >= REMINDER_INTERVAL_MS &&
    (!Number.isFinite(lastRemMs) || (nowMs - lastRemMs) >= REMINDER_INTERVAL_MS)
  return { daysInactive, lastReminderAt: u.lastReminderAt || null, needsReminder }
}

/** 提醒邮件模板（text）；游戏地址从环境变量 SITE_URL 读取（公开仓库不含真实值），未设置时显示占位文字 */
function buildReminderMail(u, daysInactive) {
  const siteUrl = process.env.SITE_URL || '游戏网址'
  return {
    subject: `【方块对照】${u.childName}小朋友今天还没玩小游戏哦`,
    text: `您好！\n\n${u.childName}小朋友已经 ${daysInactive} 天没有进行小游戏训练了。请抽空打开 ${siteUrl} 登录完成今日练习。\n登录方式：输入编号 ${u.participantId}（两次）和儿童姓氏「${u.childSurname}」。\n\n谢谢配合！\n方块对照实验组`,
  }
}

/** 北京时间（UTC+8）的小时/分钟/日期串 */
function beijingParts(nowMs) {
  const d = new Date(nowMs + 8 * 3600 * 1000)
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes(), date: d.toISOString().slice(0, 10) }
}

/** 自动发送窗口：北京时间 09:00~09:29 */
function inAutoReminderWindow(nowMs) {
  const b = beijingParts(nowMs)
  return b.hour === 9 && b.minute >= 0 && b.minute <= 29
}

let autoReminderDateMem = null // 内存标记：今天已自动发送过（与 data.json 的 lastAutoReminderDate 双保险）

/** 对一批用户逐封发送提醒（1s/封防频控），成功才更新 lastReminderAt，单用户失败不影响其他人 */
async function sendRemindersToUsers(cfg, data, users, nowMs) {
  const sent = []
  const failed = []
  for (const u of users) {
    const info = reminderInfo(data, u, nowMs)
    const email = String(u.email || '').trim()
    if (!email) {
      failed.push({ participantId: u.participantId, childName: u.childName, email: '', reason: '未填写邮箱' })
      continue
    }
    const mail = buildReminderMail(u, info.daysInactive)
    try {
      await sendMail(cfg, { to: email, subject: mail.subject, text: mail.text })
      u.lastReminderAt = new Date(nowMs).toISOString() // 仅成功才更新
      sent.push({ participantId: u.participantId, childName: u.childName, email })
    } catch (e) {
      failed.push({ participantId: u.participantId, childName: u.childName, email, reason: e.message || '发送失败' })
    }
    await sleep(1000) // 1s/封防频控
  }
  return { sent, failed }
}

/** 自动定时检查：北京时间 09:00~09:29 且今天未发过 → 对全部 needsReminder 用户发送 */
async function autoReminderTick() {
  try {
    const now = Date.now()
    if (!inAutoReminderWindow(now)) return
    const cfg = loadEmailConfig()
    if (!cfg) return // 未配置不执行
    const bj = beijingParts(now)
    const data = loadData()
    if (autoReminderDateMem === bj.date || data.lastAutoReminderDate === bj.date) {
      autoReminderDateMem = bj.date
      return
    }
    autoReminderDateMem = bj.date
    data.lastAutoReminderDate = bj.date // 先落盘，崩溃重启今天也不重复
    const targets = Object.values(data.users).filter((u) => reminderInfo(data, u, now).needsReminder)
    console.log(`[email] 自动提醒（${bj.date}）：${targets.length} 位用户待发送`)
    const { sent, failed } = await sendRemindersToUsers(cfg, data, targets, now)
    for (const f of failed) console.error(`[email] 提醒发送失败 ${f.participantId}：${f.reason}`)
    saveData(data) // 落盘 lastAutoReminderDate + 各用户 lastReminderAt
    console.log(`[email] 自动提醒完成：成功 ${sent.length}，失败 ${failed.length}`)
  } catch (e) {
    console.error('[email] 自动提醒任务异常：', e)
  }
}

/* ---------------- API 路由 ---------------- */

async function handleApi(req, res, urlPath) {
  const data = loadData()
  const method = req.method || 'GET'

  // POST /api/register
  if (method === 'POST' && urlPath === '/api/register') {
    const body = await readJsonBody(req)
    const participantId = String(body.participantId ?? '').trim()
    const childName = String(body.childName ?? '').trim()
    const childGender = String(body.childGender ?? '').trim()
    const email = String(body.email ?? '').trim()

    if (!/^\d{4}$/.test(participantId)) throw httpError(400, '编号必须是正好 4 位数字')
    if (data.users[participantId]) throw httpError(409, '该编号已注册')
    if (!childName || !childGender) throw httpError(400, '请填写完整信息（孩子姓名、孩子性别为必填）')
    const parts = splitChineseName(childName)
    if (!parts) throw httpError(400, '孩子姓名不正确（需为至少两个字的中文全名）')
    if (childGender !== '男' && childGender !== '女') throw httpError(400, '孩子性别只能是「男」或「女」')
    if (email && !EMAIL_RE.test(email)) throw httpError(400, '邮箱格式不正确')
    const age = normalizeChildAge(body.childAge)
    if (!age.ok) throw httpError(400, '孩子年龄必须是 0~18 的数字')

    const user = {
      participantId,
      childSurname: parts.surname,
      childGivenName: parts.given,
      childName: parts.surname + parts.given,
      childAge: age.value,
      childGender,
      email,
      registeredAt: new Date().toISOString(),
      lastReminderAt: null,
    }
    const token = newToken()
    data.users[participantId] = user
    data.userTokens[token] = participantId
    saveData(data)
    sendJson(res, 200, { ok: true, token, user: publicUser(user) })
    return
  }

  // POST /api/login  credential 形如 "0101张"（4 位编号 + 儿童姓）
  if (method === 'POST' && urlPath === '/api/login') {
    const body = await readJsonBody(req)
    const credential = String(body.credential ?? '').trim()
    const m = /^(\d{4})(\S+)$/.exec(credential)
    const fail = () => { throw httpError(401, '編號或姓氏不正確') }
    if (!m) fail()
    const user = data.users[m[1]]
    if (!user || !user.childSurname || user.childSurname !== m[2]) fail()
    const token = newToken()
    data.userTokens[token] = user.participantId
    saveData(data)
    sendJson(res, 200, { ok: true, token, user: publicUser(user) })
    return
  }

  // POST /api/session  （用户 token）
  if (method === 'POST' && urlPath === '/api/session') {
    const pid = authUser(req, data)
    if (!pid) throw httpError(401, '未登录或登录状态无效')
    const body = await readJsonBody(req)
    const log = body.log
    if (!log || typeof log !== 'object' || Array.isArray(log)) throw httpError(400, '缺少会话数据（log）')

    const sum = summarizeLog(log)
    const sessionId = sessionIdFor(pid, sum.sessionStart)
    // upsert：同一用户 + 相同 sessionStart 覆盖旧记录，不产生重复
    data.sessions[sessionId] = {
      sessionId,
      participantId: pid,
      sessionStart: sum.sessionStart,
      durationSec: sum.durationSec,
      followed: sum.followed,
      followedTotal: sum.followedTotal,
      completed: sum.completed,
      receivedAt: new Date().toISOString(),
      log,
    }
    saveData(data)
    sendJson(res, 200, { ok: true, sessionId })
    return
  }

  // PUT /api/user/profile  （用户 token）修改本人资料；participantId 不可通过此接口修改
  if (method === 'PUT' && urlPath === '/api/user/profile') {
    const pid = authUser(req, data)
    if (!pid) throw httpError(401, '未登录或登录状态无效')
    const body = await readJsonBody(req)
    const childName = String(body.childName ?? '').trim()
    const childGender = String(body.childGender ?? '').trim()
    const email = String(body.email ?? '').trim()

    if (!childName || !childGender || !email) {
      throw httpError(400, '请填写完整信息（孩子姓名、孩子性别、邮箱为必填）')
    }
    const parts = splitChineseName(childName)
    if (!parts) throw httpError(400, '孩子姓名不正确（需为至少两个字的中文全名）')
    if (childGender !== '男' && childGender !== '女') throw httpError(400, '孩子性别只能是「男」或「女」')
    if (!EMAIL_RE.test(email)) throw httpError(400, '邮箱格式不正确')

    const user = data.users[pid]
    user.childSurname = parts.surname
    user.childGivenName = parts.given
    user.childName = parts.surname + parts.given
    if (body.childAge !== undefined) {
      const age = normalizeChildAge(body.childAge)
      if (!age.ok) throw httpError(400, '孩子年龄必须是 0~18 的数字')
      user.childAge = age.value
    }
    user.childGender = childGender
    user.email = email
    saveData(data)
    sendJson(res, 200, { ok: true, user: publicUser(user) })
    return
  }

  // POST /api/admin/login
  // admin 凭据从环境变量读取（公开仓库不含真实值）；未设置 ADMIN_PASSWORD 时后台登录不可用
  const ADMIN_USER = process.env.ADMIN_USER || 'admin'
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''
  if (method === 'POST' && urlPath === '/api/admin/login') {
    const body = await readJsonBody(req)
    if (!ADMIN_PASSWORD || body.username !== ADMIN_USER || body.password !== ADMIN_PASSWORD) {
      throw httpError(401, '用户名或密码不正确')
    }
    const token = newToken()
    data.adminTokens[token] = true
    saveData(data)
    sendJson(res, 200, { ok: true, token })
    return
  }

  // 以下均为 admin 鉴权接口
  if (urlPath === '/api/admin/overview' || urlPath === '/api/admin/import-users' ||
      urlPath === '/api/admin/send-reminders' || urlPath === '/api/admin/daily' ||
      urlPath.startsWith('/api/admin/users') || urlPath.startsWith('/api/admin/sessions') ||
      urlPath.startsWith('/api/admin/export/')) {
    if (!authAdmin(req, data)) throw httpError(401, '未授权（需要管理员登录）')

    // POST /api/admin/send-reminders  立即对全部 needsReminder 用户发送提醒邮件
    if (method === 'POST' && urlPath === '/api/admin/send-reminders') {
      const cfg = loadEmailConfig()
      if (!cfg) throw httpError(503, '邮件服务未配置，请先在服务器上配置发件邮箱')
      const now = Date.now()
      const targets = []
      let skipped = 0
      for (const u of Object.values(data.users)) {
        if (reminderInfo(data, u, now).needsReminder) targets.push(u)
        else skipped++
      }
      const { sent, failed } = await sendRemindersToUsers(cfg, data, targets, now)
      if (sent.length > 0) saveData(data) // 成功才更新 lastReminderAt，失败不动；单用户失败不影响其他人
      sendJson(res, 200, { ok: true, sent, failed, skipped })
      return
    }

    // GET /api/admin/overview
    if (method === 'GET' && urlPath === '/api/admin/overview') {
      const sessions = Object.values(data.sessions)
      let totalPlaySeconds = 0
      let totalPieces = 0
      let totalFollowed = 0
      for (const s of sessions) {
        totalPlaySeconds += effectiveDurationSec(s)
        const fc = followedCounts(s)
        totalPieces += fc.total
        totalFollowed += fc.followed
      }
      sendJson(res, 200, {
        userCount: Object.keys(data.users).length,
        sessionCount: sessions.length,
        totalPlaySeconds,
        totalPieces,
        totalFollowed,
      })
      return
    }

    // POST /api/admin/import-users  批量导入用户：合法且不撞号的行导入，非法行逐行报告
    if (method === 'POST' && urlPath === '/api/admin/import-users') {
      const body = await readJsonBody(req)
      const list = body.users
      if (!Array.isArray(list) || list.length === 0) throw httpError(400, 'users 必须是非空数组')
      if (list.length > 500) throw httpError(400, '一次最多导入 500 个用户')

      const failed = []
      const toAdd = []
      const seen = new Set()
      list.forEach((row, i) => {
        const index = i + 1
        const r = row && typeof row === 'object' ? row : {}
        const participantId = String(r.participantId ?? '').trim()
        const childName = String(r.childName ?? '').trim()
        const childGender = String(r.childGender ?? '').trim()
        const email = String(r.email ?? '').trim()
        const fail = (reason) => failed.push({ index, participantId, childName, reason })

        if (!/^\d{4}$/.test(participantId)) return fail('编号必须是正好 4 位数字')
        if (data.users[participantId] || seen.has(participantId)) return fail('该编号已注册')
        if (!childName) return fail('孩子姓名不能为空')
        const parts = splitChineseName(childName)
        if (!parts) return fail('孩子姓名不正确（需为至少两个字的中文全名）')
        if (childGender !== '男' && childGender !== '女') return fail('孩子性别只能是「男」或「女」')
        if (email && !EMAIL_RE.test(email)) return fail('邮箱格式不正确')
        const age = normalizeChildAge(r.childAge)
        if (!age.ok) return fail('孩子年龄必须是 0~18 的数字')

        seen.add(participantId)
        toAdd.push({
          participantId,
          childSurname: parts.surname,
          childGivenName: parts.given,
          childName: parts.surname + parts.given,
          childAge: age.value,
          childGender,
          email,
          registeredAt: new Date().toISOString(),
        })
      })
      if (toAdd.length > 0) {
        for (const u of toAdd) data.users[u.participantId] = u
        saveData(data)
      }
      sendJson(res, 200, { ok: true, imported: toAdd.length, failed })
      return
    }

    // GET /api/admin/users
    if (method === 'GET' && urlPath === '/api/admin/users') {
      const now = Date.now()
      const list = Object.values(data.users)
        .map((u) => ({ ...publicUser(u), ...userStats(data, u.participantId), ...reminderInfo(data, u, now) }))
        .sort((a, b) => a.participantId.localeCompare(b.participantId))
      sendJson(res, 200, list)
      return
    }

    // GET /api/admin/users/:participantId/sessions
    let m = /^\/api\/admin\/users\/(\d{4})\/sessions$/.exec(urlPath)
    if (method === 'GET' && m) {
      if (!data.users[m[1]]) throw httpError(404, '用户不存在')
      const list = Object.values(data.sessions)
        .filter((s) => s.participantId === m[1])
        .map(sessionSummary)
        .sort((a, b) => (a.sessionStart || a.receivedAt).localeCompare(b.sessionStart || b.receivedAt))
      sendJson(res, 200, list)
      return
    }

    // GET /api/admin/users/:participantId/daily  按北京时间（UTC+8）日期聚合该用户的每日游玩时长
    m = /^\/api\/admin\/users\/(\d{4})\/daily$/.exec(urlPath)
    if (method === 'GET' && m) {
      const pid = m[1]
      if (!data.users[pid]) throw httpError(404, '用户不存在')
      sendJson(res, 200, { ok: true, participantId: pid, days: dailyDays(data, pid) })
      return
    }

    // GET /api/admin/daily  全部用户的每日游玩聚合（供导出 Excel；结构同单用户 daily 的 days）
    if (method === 'GET' && urlPath === '/api/admin/daily') {
      const users = Object.values(data.users)
        .map((u) => ({
          participantId: u.participantId,
          childSurname: u.childSurname || '',
          childGivenName: u.childGivenName || '',
          childName: u.childName || '',
          days: dailyDays(data, u.participantId),
        }))
        .sort((a, b) => a.participantId.localeCompare(b.participantId))
      sendJson(res, 200, { ok: true, users })
      return
    }

    // PUT /api/admin/users/:participantId  管理员修改用户资料/编号（body 为可更新字段的任意子集）
    m = /^\/api\/admin\/users\/(\d{4})$/.exec(urlPath)
    if (method === 'PUT' && m) {
      const oldId = m[1]
      const user = data.users[oldId]
      if (!user) throw httpError(404, '用户不存在')
      const body = await readJsonBody(req)

      const patch = {}
      if (body.childSurname !== undefined) {
        const v = String(body.childSurname ?? '').trim()
        if (!v) throw httpError(400, '孩子姓氏不能为空')
        patch.childSurname = v
      }
      if (body.childGivenName !== undefined) {
        const v = String(body.childGivenName ?? '').trim()
        if (!v) throw httpError(400, '孩子名字不能为空')
        patch.childGivenName = v
      }
      if (body.childAge !== undefined) {
        const age = normalizeChildAge(body.childAge)
        if (!age.ok) throw httpError(400, '孩子年龄必须是 0~18 的数字')
        patch.childAge = age.value
      }
      if (body.childGender !== undefined) {
        const v = String(body.childGender ?? '').trim()
        if (v !== '男' && v !== '女') throw httpError(400, '孩子性别只能是「男」或「女」')
        patch.childGender = v
      }
      if (body.email !== undefined) {
        const v = String(body.email ?? '').trim()
        if (v && !EMAIL_RE.test(v)) throw httpError(400, '邮箱格式不正确')
        patch.email = v
      }

      let newId = oldId
      if (body.participantId !== undefined) {
        newId = String(body.participantId ?? '').trim()
        if (!/^\d{4}$/.test(newId)) throw httpError(400, '编号必须是正好 4 位数字')
        if (newId !== oldId && data.users[newId]) throw httpError(409, '该编号已被使用')
      }

      Object.assign(user, patch)
      // 姓或名任一更新则 childName 同步 = childSurname + childGivenName
      if (patch.childSurname !== undefined || patch.childGivenName !== undefined) {
        user.childName = (user.childSurname || '') + (user.childGivenName || '')
      }
      if (newId !== oldId) {
        user.participantId = newId
        delete data.users[oldId]
        data.users[newId] = user
        // 级联：sessions 与 userTokens 中的编号同步更新，保持登录态不断；
        // sessionId 由旧编号+sessionStart 哈希而来，无需重算
        for (const s of Object.values(data.sessions)) {
          if (s.participantId === oldId) s.participantId = newId
        }
        for (const [t, p] of Object.entries(data.userTokens)) {
          if (p === oldId) data.userTokens[t] = newId
        }
      }
      saveData(data)
      sendJson(res, 200, { ok: true, user: publicUser(user) })
      return
    }

    // DELETE /api/admin/users/:participantId  删除用户及其 sessions、userTokens
    if (method === 'DELETE' && m) {
      const pid = m[1]
      if (!data.users[pid]) throw httpError(404, '用户不存在')
      delete data.users[pid]
      let deletedSessions = 0
      for (const [sid, s] of Object.entries(data.sessions)) {
        if (s.participantId === pid) { delete data.sessions[sid]; deletedSessions++ }
      }
      for (const [t, p] of Object.entries(data.userTokens)) {
        if (p === pid) delete data.userTokens[t]
      }
      saveData(data)
      sendJson(res, 200, { ok: true, deletedSessions })
      return
    }

    // GET /api/admin/sessions/:sessionId
    m = /^\/api\/admin\/sessions\/([0-9a-f]+)$/.exec(urlPath)
    if (method === 'GET' && m) {
      const s = data.sessions[m[1]]
      if (!s) throw httpError(404, '会话不存在')
      sendJson(res, 200, s)
      return
    }

    // GET /api/admin/export/users.csv
    if (method === 'GET' && urlPath === '/api/admin/export/users.csv') {
      const now = Date.now()
      const rows = Object.values(data.users)
        .map((u) => ({ ...publicUser(u), ...userStats(data, u.participantId), ...reminderInfo(data, u, now) }))
        .sort((a, b) => a.participantId.localeCompare(b.participantId))
        .map((u) => [u.participantId, u.childSurname, u.childGivenName, u.childName, u.childAge,
          u.childGender, u.email,
          u.registeredAt, u.sessionCount, u.totalPlaySeconds, u.lastPlayedAt,
          u.totalPieces, u.totalFollowed,
          u.followedRate != null ? (u.followedRate * 100).toFixed(1) + '%' : '',
          u.daysInactive, u.lastReminderAt || ''])
      sendCsv(res, 'users.csv',
        ['participantId', 'childSurname', 'childGivenName', 'childName', 'childAge', 'childGender', 'email',
          'registeredAt', 'sessionCount', 'totalPlaySeconds', 'lastPlayedAt',
          'totalPieces', 'totalFollowed', 'followedRate', 'daysInactive', 'lastReminderAt'], rows)
      return
    }

    // GET /api/admin/export/sessions.csv
    if (method === 'GET' && urlPath === '/api/admin/export/sessions.csv') {
      const rows = Object.values(data.sessions)
        .map(sessionSummary)
        .sort((a, b) => a.participantId.localeCompare(b.participantId) ||
          (a.sessionStart || a.receivedAt).localeCompare(b.sessionStart || b.receivedAt))
        .map((s) => [s.sessionId, s.participantId, s.sessionStart, s.receivedAt,
          s.durationSec, s.followed, s.followedTotal, s.completed])
      sendCsv(res, 'sessions.csv',
        ['sessionId', 'participantId', 'sessionStart', 'receivedAt',
          'durationSec', 'followed', 'followedTotal', 'completed'], rows)
      return
    }

    throw httpError(404, '接口不存在')
  }

  throw httpError(404, '接口不存在')
}

/* ---------------- 静态文件服务（原有行为，保持不变） ---------------- */

function serveStatic(req, res, urlPath) {
  // 规范化并限制在 ROOT 内（防目录穿越 = 白名单效果）
  let filePath = path.normalize(path.join(ROOT, urlPath))
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return
  }

  let stat = null
  try { stat = fs.statSync(filePath) } catch { /* fallthrough */ }
  if (stat && stat.isDirectory()) { filePath = path.join(filePath, 'index.html'); stat = null }
  if (!stat) {
    // SPA fallback：仅对“不含点号”的路径段回退 index.html；
    // 任何形如 /.env、/x.json、/server.log 的请求一律 404（白名单严格化）
    const base = path.basename(urlPath)
    if (!base.includes('.')) filePath = path.join(ROOT, 'index.html')
    try { stat = fs.statSync(filePath) } catch { res.writeHead(404); res.end('Not Found'); return }
  }

  const ext = path.extname(filePath).toLowerCase()
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' }
  if (ext === '.html') headers['Cache-Control'] = 'no-cache'
  else if (urlPath.startsWith('/assets/')) headers['Cache-Control'] = 'public, max-age=31536000, immutable'

  res.writeHead(200, headers)
  fs.createReadStream(filePath).pipe(res)
}

/* ---------------- 入口 ---------------- */

const server = http.createServer((req, res) => {
  let urlPath
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  } catch {
    res.writeHead(400); res.end(); return
  }
  if (urlPath.includes('\0')) { res.writeHead(400); res.end(); return }

  // /api/* 路由优先于静态文件处理
  if (urlPath.startsWith('/api/')) {
    handleApi(req, res, urlPath).catch((err) => {
      if (res.headersSent) { res.end(); return }
      const status = Number.isInteger(err.status) ? err.status : 500
      if (status === 500) console.error('api error:', err)
      sendJson(res, status, { error: status === 500 ? '服务器内部错误' : err.message })
    })
    return
  }

  serveStatic(req, res, urlPath)
})

// 每 30 分钟检查一次是否进入自动提醒窗口（北京时间 09:00~09:29）；启动后 5s 也补一次检查
setInterval(autoReminderTick, 30 * 60 * 1000).unref()

if (require.main === module) {
  const bootCfg = loadEmailConfig()
  console.log(bootCfg
    ? `[email] 邮件服务已配置（${bootCfg.user} via ${bootCfg.host}:${bootCfg.port}）`
    : '[email] 邮件服务未配置（缺少 email-config.json 或字段不全），提醒功能不可用，其余功能不受影响')
  server.listen(PORT, () => {
    console.log(`tetris-web listening on :${PORT}, root=${ROOT}`)
    setTimeout(autoReminderTick, 5000).unref()
  })
}

// 导出内部函数供独立测试脚本使用（不改变运行行为，无额外 HTTP 后门）
module.exports = {
  loadEmailConfig, sendMail, buildMailMessage,
  reminderInfo, buildReminderMail, beijingParts, inAutoReminderWindow, autoReminderTick,
}
