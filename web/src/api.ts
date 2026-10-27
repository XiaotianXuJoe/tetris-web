/**
 * API client — same-origin backend contract.
 * User auth (token + user) is persisted under 'tetris-adhd-auth';
 * the admin token under 'tetris-adhd-admin'.
 */
import type { SessionLog } from '@/game/log'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
export interface User {
  participantId: string
  childSurname: string
  childGivenName: string
  childName: string
  childAge: number | null
  childGender: string
  email: string
  registeredAt?: string
}

export interface StoredAuth {
  token: string
  user: User
}

export interface RegisterPayload {
  participantId: string
  childSurname: string
  childGivenName: string
  childName: string
  childAge?: number | null
  childGender: string
  email: string
}

export interface AdminOverview {
  userCount: number
  sessionCount: number
  /** 活跃游玩秒数（不含休息/暂停） */
  totalPlaySeconds: number
  totalPieces: number
  totalFollowed: number
}

export interface AdminUser {
  participantId: string
  childSurname: string
  childGivenName: string
  childName: string
  childAge: number | null
  childGender: string
  email: string
  registeredAt: string
  sessionCount: number
  /** 活跃游玩秒数（不含休息/暂停） */
  totalPlaySeconds: number
  lastPlayedAt: string | null
  totalPieces: number
  totalFollowed: number
  /** totalPieces = 0 时为 null */
  followedRate: number | null
  /** 距上次登录游戏的整数天数（从未游玩时后端按注册时间计算） */
  daysInactive: number
  /** 最近一次提醒邮件发送时间，从未提醒为 null */
  lastReminderAt: string | null
  /** 是否满足提醒条件（满 3 天未登录且 72 小时内未提醒） */
  needsReminder: boolean
}

/** GET /api/admin/users/:participantId/daily 的单日行 */
export interface DailyRow {
  /** 'YYYY-MM-DD' */
  date: string
  block1Seconds: number
  block2Seconds: number
  block3Seconds: number
  totalSeconds: number
  sessionCount: number
  followed: number
  followedTotal: number
}

export interface AdminSessionRow {
  sessionId: string
  sessionStart: string
  durationSec: number
  followed: number
  followedTotal: number
  completed: boolean
  receivedAt: string
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */
const AUTH_KEY = 'tetris-adhd-auth'
const ADMIN_KEY = 'tetris-adhd-admin'
export const PENDING_UPLOAD_KEY = 'tetris-adhd-pending-upload'

export function loadAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredAuth
    if (!parsed || typeof parsed.token !== 'string' || !parsed.user) return null
    return parsed
  } catch {
    return null
  }
}

export function saveAuth(auth: StoredAuth): void {
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify(auth))
  } catch {
    /* storage unavailable */
  }
}

export function clearAuth(): void {
  try {
    localStorage.removeItem(AUTH_KEY)
  } catch {
    /* ignore */
  }
}

export function loadAdminToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_KEY)
  } catch {
    return null
  }
}

export function saveAdminToken(token: string): void {
  try {
    localStorage.setItem(ADMIN_KEY, token)
  } catch {
    /* ignore */
  }
}

export function clearAdminToken(): void {
  try {
    localStorage.removeItem(ADMIN_KEY)
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Fetch helpers                                                       */
/* ------------------------------------------------------------------ */
interface ApiResult<T> {
  status: number
  data: T | null
  error: string | null
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  token?: string | null,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    const res = await fetch(path, { ...init, headers })
    let data: T | null = null
    let error: string | null = null
    try {
      const body = (await res.json()) as T & { error?: string }
      data = body
      if (!res.ok) error = typeof body?.error === 'string' ? body.error : `请求失败（${res.status}）`
    } catch {
      if (!res.ok) error = `请求失败（${res.status}）`
    }
    return { status: res.status, data, error }
  } catch {
    return { status: 0, data: null, error: '網絡連接失敗，請稍後重試' }
  }
}

/* ------------------------------------------------------------------ */
/* User auth                                                           */
/* ------------------------------------------------------------------ */
export async function registerUser(
  payload: RegisterPayload,
): Promise<{ ok: true; user: User } | { ok: false; error: string }> {
  const r = await request<{ ok: boolean; token: string; user: User }>('/api/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  if (r.status === 200 && r.data?.ok && r.data.token && r.data.user) {
    saveAuth({ token: r.data.token, user: r.data.user })
    return { ok: true, user: r.data.user }
  }
  return { ok: false, error: r.error ?? '注册失败，请稍后重试' }
}

export async function loginUser(
  credential: string,
): Promise<{ ok: true; user: User } | { ok: false; error: string }> {
  const r = await request<{ ok: boolean; token: string; user: User }>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ credential }),
  })
  if (r.status === 200 && r.data?.ok && r.data.token && r.data.user) {
    saveAuth({ token: r.data.token, user: r.data.user })
    return { ok: true, user: r.data.user }
  }
  return { ok: false, error: r.error ?? '登錄失敗，請稍後重試' }
}

/* ------------------------------------------------------------------ */
/* User profile update                                                 */
/* ------------------------------------------------------------------ */
export interface ProfileFields {
  childSurname: string
  childGivenName: string
  childName: string
  childAge?: number | null
  childGender: string
  email: string
}

export type ProfileUpdateResult =
  | { ok: true; user: User }
  | { ok: false; error: string; unauthorized: boolean }

/**
 * PUT /api/user/profile. On success the stored auth keeps its token but
 * adopts the fresh user record. 401 → { ok:false, unauthorized:true }.
 */
export async function updateProfile(
  token: string,
  fields: ProfileFields,
): Promise<ProfileUpdateResult> {
  const r = await request<{ ok: boolean; user: User }>('/api/user/profile', {
    method: 'PUT',
    body: JSON.stringify(fields),
  }, token)
  if (r.status === 200 && r.data?.ok && r.data.user) {
    const stored = loadAuth()
    if (stored) saveAuth({ token: stored.token, user: r.data.user })
    return { ok: true, user: r.data.user }
  }
  return {
    ok: false,
    error: r.error ?? '保存失败，请稍后重试',
    unauthorized: r.status === 401,
  }
}

/* ------------------------------------------------------------------ */
/* Session upload                                                      */
/* ------------------------------------------------------------------ */
export type UploadResult = 'ok' | 'unauthorized' | 'failed'

/**
 * POST a session log. With `keepalive: true` the request survives page
 * unload (best-effort, response unreadable) — used on pagehide.
 */
export async function uploadSession(
  token: string,
  log: SessionLog,
  keepalive = false,
): Promise<UploadResult> {
  try {
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ log }),
      keepalive,
    })
    if (res.status === 401) return 'unauthorized'
    return res.ok ? 'ok' : 'failed'
  } catch {
    return 'failed'
  }
}

/** Pending uploads are kept as a list so a later failure never drops an earlier one. */
export function appendPendingUpload(log: SessionLog): void {
  try {
    const logs = loadPendingUploads()
    logs.push(log)
    localStorage.setItem(PENDING_UPLOAD_KEY, JSON.stringify(logs))
  } catch {
    /* storage unavailable */
  }
}

export function loadPendingUploads(): SessionLog[] {
  try {
    const raw = localStorage.getItem(PENDING_UPLOAD_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SessionLog[]) : []
  } catch {
    return []
  }
}

export function savePendingUploads(logs: SessionLog[]): void {
  try {
    if (logs.length === 0) localStorage.removeItem(PENDING_UPLOAD_KEY)
    else localStorage.setItem(PENDING_UPLOAD_KEY, JSON.stringify(logs))
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */
export async function adminLogin(
  username: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await request<{ ok: boolean; token: string }>('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  if (r.status === 200 && r.data?.ok && r.data.token) {
    saveAdminToken(r.data.token)
    return { ok: true }
  }
  return { ok: false, error: r.error ?? '登录失败' }
}

/** Returns data on success, 'unauthorized' on 401, null on other failure. */
async function adminGet<T>(path: string, token: string): Promise<T | 'unauthorized' | null> {
  const r = await request<T>(path, {}, token)
  if (r.status === 401) return 'unauthorized'
  if (r.status === 200 && r.data !== null) return r.data
  return null
}

export const adminApi = {
  overview: (token: string) => adminGet<AdminOverview>('/api/admin/overview', token),
  users: (token: string) => adminGet<AdminUser[]>('/api/admin/users', token),
  userSessions: (token: string, participantId: string) =>
    adminGet<AdminSessionRow[]>(
      `/api/admin/users/${encodeURIComponent(participantId)}/sessions`,
      token,
    ),
  sessionDetail: (token: string, sessionId: string) =>
    adminGet<Record<string, unknown>>(
      `/api/admin/sessions/${encodeURIComponent(sessionId)}`,
      token,
    ),
}

export interface AdminUserPatch {
  participantId?: string
  childSurname?: string
  childGivenName?: string
  childAge?: number | null
  childGender?: string
  email?: string
}

export type AdminWriteResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number; unauthorized: boolean }

/**
 * PUT /api/admin/users/:participantId — patch any subset of user fields
 * (participantId itself may be changed). 409 = 编号已被使用.
 */
export async function adminUpdateUser(
  token: string,
  participantId: string,
  fields: AdminUserPatch,
): Promise<AdminWriteResult<{ ok: boolean; user: AdminUser }>> {
  const r = await request<{ ok: boolean; user: AdminUser }>(
    `/api/admin/users/${encodeURIComponent(participantId)}`,
    { method: 'PUT', body: JSON.stringify(fields) },
    token,
  )
  if (r.status === 200 && r.data?.ok && r.data.user) {
    return { ok: true, data: r.data }
  }
  return {
    ok: false,
    error: r.error ?? '保存失败，请稍后重试',
    status: r.status,
    unauthorized: r.status === 401,
  }
}

/* ------------------------------------------------------------------ */
/* Admin: batch import users                                           */
/* ------------------------------------------------------------------ */
export interface ImportUserItem {
  participantId: string
  childName: string
  childAge?: number | null
  childGender: string
  email: string
}

export interface ImportFailure {
  index: number
  participantId: string
  childName: string
  reason: string
}

export interface ImportUsersResult {
  ok: boolean
  imported: number
  failed: ImportFailure[]
}

/**
 * POST /api/admin/import-users — batch import parsed spreadsheet rows.
 * 401 → unauthorized (admin token expired).
 */
export async function importUsers(
  token: string,
  users: ImportUserItem[],
): Promise<AdminWriteResult<ImportUsersResult>> {
  const r = await request<ImportUsersResult>(
    '/api/admin/import-users',
    { method: 'POST', body: JSON.stringify({ users }) },
    token,
  )
  if (r.status === 200 && r.data?.ok) {
    return { ok: true, data: r.data }
  }
  return {
    ok: false,
    error: r.error ?? '导入失败，请稍后重试',
    status: r.status,
    unauthorized: r.status === 401,
  }
}

/**
 * DELETE /api/admin/users/:participantId — removes the user and all of
 * their session records (irreversible).
 */
export async function adminDeleteUser(
  token: string,
  participantId: string,
): Promise<AdminWriteResult<{ ok: boolean; deletedSessions: number }>> {
  const r = await request<{ ok: boolean; deletedSessions: number }>(
    `/api/admin/users/${encodeURIComponent(participantId)}`,
    { method: 'DELETE' },
    token,
  )
  if (r.status === 200 && r.data?.ok) {
    return { ok: true, data: r.data }
  }
  return {
    ok: false,
    error: r.error ?? '删除失败，请稍后重试',
    status: r.status,
    unauthorized: r.status === 401,
  }
}

/**
 * GET /api/admin/users/:participantId/daily — 按日期升序的每日游玩汇总。
 * 401 → unauthorized；404 → 用户不存在.
 */
export async function getUserDaily(
  token: string,
  participantId: string,
): Promise<AdminWriteResult<{ ok: boolean; participantId: string; days: DailyRow[] }>> {
  const r = await request<{ ok: boolean; participantId: string; days: DailyRow[] }>(
    `/api/admin/users/${encodeURIComponent(participantId)}/daily`,
    {},
    token,
  )
  if (r.status === 200 && r.data?.ok && Array.isArray(r.data.days)) {
    return { ok: true, data: r.data }
  }
  return {
    ok: false,
    error: r.error ?? (r.status === 404 ? '用户不存在或已被删除' : '加载失败，请稍后重试'),
    status: r.status,
    unauthorized: r.status === 401,
  }
}

/** GET /api/admin/daily 的单用户条目（全部用户每日聚合，供导出 Excel） */
export interface AllDailyUser {
  participantId: string
  childSurname: string
  childGivenName: string
  childName: string
  days: DailyRow[]
}

/**
 * GET /api/admin/daily — 全部用户每日游玩汇总。
 * 401 → unauthorized.
 */
export async function getAllUsersDaily(
  token: string,
): Promise<AdminWriteResult<{ ok: boolean; users: AllDailyUser[] }>> {
  const r = await request<{ ok: boolean; users: AllDailyUser[] }>('/api/admin/daily', {}, token)
  if (r.status === 200 && r.data?.ok && Array.isArray(r.data.users)) {
    return { ok: true, data: r.data }
  }
  return {
    ok: false,
    error: r.error ?? '加载失败，请稍后重试',
    status: r.status,
    unauthorized: r.status === 401,
  }
}

/* ------------------------------------------------------------------ */
/* Admin: send inactivity reminder emails                              */
/* ------------------------------------------------------------------ */
export interface ReminderSentItem {
  participantId: string
  childName: string
  email: string
}

export interface ReminderFailedItem {
  participantId: string
  childName: string
  email: string
  reason: string
}

export interface SendRemindersData {
  ok: boolean
  sent: ReminderSentItem[]
  failed: ReminderFailedItem[]
  skipped: number
}

/**
 * POST /api/admin/send-reminders — email users inactive for ≥3 days.
 * 401 → unauthorized；503 → 邮件服务未配置（error 取后端文案）.
 */
export async function sendReminders(
  token: string,
): Promise<AdminWriteResult<SendRemindersData>> {
  const r = await request<SendRemindersData>(
    '/api/admin/send-reminders',
    { method: 'POST' },
    token,
  )
  if (r.status === 200 && r.data?.ok) {
    return { ok: true, data: r.data }
  }
  return {
    ok: false,
    error: r.error ?? '发送失败，请稍后重试',
    status: r.status,
    unauthorized: r.status === 401,
  }
}

/** Authenticated CSV export: fetch blob with Authorization header, then download. */
export async function adminExportCsv(
  token: string,
  path: string,
  filename: string,
): Promise<boolean> {
  try {
    const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return false
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 5000)
    return true
  } catch {
    return false
  }
}
