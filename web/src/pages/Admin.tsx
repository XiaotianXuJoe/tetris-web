import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { BarChart3, Bell } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TooltipProps } from 'recharts'
import {
  adminApi,
  adminDeleteUser,
  adminExportCsv,
  adminLogin,
  adminUpdateUser,
  clearAdminToken,
  getAllUsersDaily,
  getUserDaily,
  importUsers,
  loadAdminToken,
  sendReminders,
} from '@/api'
import type {
  AdminOverview,
  AdminSessionRow,
  AdminUser,
  DailyRow,
  ImportFailure,
  ImportUserItem,
  SendRemindersData,
} from '@/api'

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                  */
/* ------------------------------------------------------------------ */
function formatDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || Number.isNaN(sec)) return '—'
  const s = Math.round(sec)
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return rs === 0 ? `${m} 分钟` : `${m} 分 ${rs} 秒`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm === 0 ? `${h} 小时` : `${h} 小时 ${rm} 分`
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', { hour12: false })
}

/** 紧凑格式：10/11 09:00（本时区），null/非法 → '—' */
function formatShortTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/* ------------------------------------------------------------------ */
/* Admin page                                                          */
/* ------------------------------------------------------------------ */
export default function Admin() {
  const [token, setToken] = useState<string | null>(() => loadAdminToken())

  if (!token) return <AdminLogin onSuccess={setToken} />
  return <Dashboard token={token} onLogout={() => setToken(null)} />
}

/* ------------------------------------------------------------------ */
/* Login form                                                          */
/* ------------------------------------------------------------------ */
function AdminLogin({ onSuccess }: { onSuccess: (token: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) {
      setError('请输入用户名和密码')
      return
    }
    setBusy(true)
    setError('')
    const r = await adminLogin(username.trim(), password)
    setBusy(false)
    if (r.ok) onSuccess(loadAdminToken()!)
    else setError(r.error)
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-stone-200 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-stone-300 bg-stone-50 p-8 shadow-sm"
      >
        <h1 className="text-xl font-semibold tracking-wide text-stone-600">后台管理</h1>
        <p className="mt-1 text-sm text-stone-400">实验数据管理入口，请使用管理员账号登录</p>

        <label className="mt-6 mb-1.5 block text-xs font-medium tracking-wider text-stone-500">
          用户名
        </label>
        <input
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm text-stone-700 outline-none focus:border-stone-400"
        />

        <label className="mt-4 mb-1.5 block text-xs font-medium tracking-wider text-stone-500">
          密码
        </label>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm text-stone-700 outline-none focus:border-stone-400"
        />

        {error && <p className="mt-3 text-center text-sm text-red-800/70">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full rounded-full bg-stone-500 py-2.5 text-sm font-medium tracking-widest text-stone-50 transition hover:bg-stone-600 disabled:opacity-60"
        >
          {busy ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */
function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Record<string, AdminSessionRow[] | 'loading'>>({})
  const [detail, setDetail] = useState<
    { sessionId: string; data: unknown } | { sessionId: string; loading: true } | null
  >(null)
  const [exportMsg, setExportMsg] = useState('')
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null)
  const [dailyTarget, setDailyTarget] = useState<AdminUser | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [reminderOpen, setReminderOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const handleUnauthorized = useCallback(() => {
    clearAdminToken()
    onLogout()
  }, [onLogout])

  /* Reload overview + users (initial load and after edits/deletes). */
  const reload = useCallback(async () => {
    const [ov, us] = await Promise.all([adminApi.overview(token), adminApi.users(token)])
    if (ov === 'unauthorized' || us === 'unauthorized') {
      handleUnauthorized()
      return
    }
    if (ov === null || us === null) {
      setLoadError('数据加载失败，请刷新重试')
      return
    }
    setLoadError('')
    setOverview(ov)
    setUsers(us)
  }, [token, handleUnauthorized])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [ov, us] = await Promise.all([adminApi.overview(token), adminApi.users(token)])
      if (cancelled) return
      if (ov === 'unauthorized' || us === 'unauthorized') {
        handleUnauthorized()
        return
      }
      if (ov === null || us === null) {
        setLoadError('数据加载失败，请刷新重试')
        return
      }
      setOverview(ov)
      setUsers(us)
    })()
    return () => {
      cancelled = true
    }
  }, [token, handleUnauthorized])

  const toggleUser = async (participantId: string) => {
    if (expandedId === participantId) {
      setExpandedId(null)
      return
    }
    setExpandedId(participantId)
    if (sessions[participantId]) return
    setSessions((s) => ({ ...s, [participantId]: 'loading' }))
    const rows = await adminApi.userSessions(token, participantId)
    if (rows === 'unauthorized') {
      handleUnauthorized()
      return
    }
    setSessions((s) => ({ ...s, [participantId]: rows ?? [] }))
  }

  const openDetail = async (sessionId: string) => {
    setDetail({ sessionId, loading: true })
    const data = await adminApi.sessionDetail(token, sessionId)
    if (data === 'unauthorized') {
      handleUnauthorized()
      return
    }
    setDetail({ sessionId, data: data ?? { error: '加载失败' } })
  }

  const exportCsv = async (path: string, filename: string) => {
    setExportMsg('')
    const ok = await adminExportCsv(token, path, filename)
    setExportMsg(ok ? `已导出 ${filename}` : '导出失败，请重试')
  }

  /* 导出全部用户的每日游玩详情为单个 sheet 的 xlsx：
     每个用户 × 每个日期一行，时长列为数值秒（0.1 精度，便于后续统计处理） */
  const exportDailyXlsx = async () => {
    setExportMsg('')
    const r = await getAllUsersDaily(token)
    if (r.ok === false) {
      if (r.unauthorized) {
        handleUnauthorized()
        return
      }
      setExportMsg(r.error)
      return
    }
    const header = [
      '编号',
      '儿童姓',
      '儿童名',
      '日期',
      '第1轮(秒)',
      '第2轮(秒)',
      '第3轮(秒)',
      '总时长(秒)',
      '游玩次数',
      '方块总数',
      '推荐位置数',
      '推荐比例(%)',
    ]
    const rows: (string | number)[][] = []
    for (const u of r.data.users) {
      for (const d of u.days) {
        rows.push([
          u.participantId,
          u.childSurname,
          u.childGivenName,
          d.date,
          d.block1Seconds,
          d.block2Seconds,
          d.block3Seconds,
          d.totalSeconds,
          d.sessionCount,
          d.followedTotal,
          d.followed,
          d.followedTotal > 0 ? Math.round((d.followed / d.followedTotal) * 1000) / 10 : 0,
        ])
      }
    }
    if (rows.length === 0) {
      setExportMsg('暂无游玩数据可导出')
      return
    }
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
    /* 编号/日期强制文本，保留前导零与 YYYY-MM-DD 原样 */
    for (let i = 1; i <= rows.length; i++) {
      for (const c of [0, 1, 2, 3]) {
        const cell = ws[XLSX.utils.encode_cell({ r: i, c })]
        if (cell) cell.z = '@'
      }
    }
    ws['!cols'] = header.map((h) => ({ wch: Math.max(h.length * 2 + 2, 10) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '每日游玩详情')
    const filename = `每日游玩详情-${new Date().toISOString().slice(0, 10)}.xlsx`
    XLSX.writeFile(wb, filename)
    setExportMsg(`已导出 ${filename}（${rows.length} 行）`)
  }

  const logout = () => {
    clearAdminToken()
    onLogout()
  }

  /* After a user is edited, their participantId may have changed — the
     cached expansion/sessions live under the OLD id, so reset them. */
  const handleEdited = () => {
    setEditTarget(null)
    setExpandedId(null)
    setSessions({})
    void reload()
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleteBusy(true)
    setDeleteError('')
    const r = await adminDeleteUser(token, deleteTarget.participantId)
    setDeleteBusy(false)
    if (r.ok) {
      // If the deleted user's sessions were expanded/cached, drop them too.
      setSessions((s) => {
        const next = { ...s }
        delete next[deleteTarget.participantId]
        return next
      })
      if (expandedId === deleteTarget.participantId) setExpandedId(null)
      setDeleteTarget(null)
      void reload()
      return
    }
    if (r.unauthorized) {
      handleUnauthorized()
      return
    }
    setDeleteError(r.error)
  }

  /* Shared cell classes: nowrap everywhere so编号/按钮/表头都不折行。
     表格 w-full 自适应容器；仅窄屏时由外层 overflow-x-auto 横向滚动，
     「操作」列 sticky 固定在右侧始终可见。 */
  const thCls =
    'whitespace-nowrap px-3 py-2.5 text-left text-xs font-medium tracking-wider text-stone-400'
  const tdCls = 'whitespace-nowrap px-3 py-3 text-sm text-stone-600'
  /* 操作列 sticky：背景与行背景一致，左侧淡阴影分隔 */
  const stickyShadow = 'shadow-[-8px_0_10px_-6px_rgba(68,64,60,0.18)]'
  const thStickyCls = `${thCls} sticky right-0 bg-stone-100 ${stickyShadow}`
  const tdNumCls = `${tdCls} tabular-nums`
  /* 低饱和 pill 按钮 */
  const btnOutlineCls =
    'inline-flex items-center whitespace-nowrap rounded-full border border-stone-300 bg-stone-50 px-4 py-1.5 text-xs font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-600'
  const btnSolidCls =
    'inline-flex items-center whitespace-nowrap rounded-full bg-stone-600 px-4 py-1.5 text-xs font-medium text-stone-50 transition-colors hover:bg-stone-700'

  return (
    <div className="fixed inset-0 overflow-y-auto bg-stone-200">
      <div className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-10">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-wide text-stone-700">后台管理</h1>
            <p className="mt-1 text-sm text-stone-400">俄罗斯方块实验数据总览</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setReminderOpen(true)}
              className={btnOutlineCls}
            >
              <Bell className="mr-1.5 h-3.5 w-3.5" />
              发送提醒
            </button>
            <button type="button" onClick={() => setImportOpen(true)} className={btnOutlineCls}>
              批量导入
            </button>
            <button
              type="button"
              onClick={() => exportCsv('/api/admin/export/users.csv', 'users.csv')}
              className={btnOutlineCls}
            >
              导出用户汇总 CSV
            </button>
            <button
              type="button"
              onClick={() => exportCsv('/api/admin/export/sessions.csv', 'sessions.csv')}
              className={btnOutlineCls}
            >
              导出会话明细 CSV
            </button>
            <button type="button" onClick={() => void exportDailyXlsx()} className={btnOutlineCls}>
              导出每日详情 Excel
            </button>
            <button type="button" onClick={logout} className={btnSolidCls}>
              退出登录
            </button>
          </div>
        </div>
        {exportMsg && <p className="mt-2 text-right text-xs text-stone-400">{exportMsg}</p>}

        {/* Overview cards */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              label: '被试人数',
              value: overview ? String(overview.userCount) : '…',
              unit: overview ? '人' : '',
              sub: null,
            },
            {
              label: '总会话数',
              value: overview ? String(overview.sessionCount) : '…',
              unit: overview ? '次' : '',
              sub: null,
            },
            {
              label: '总游玩时长',
              value: overview ? formatDuration(overview.totalPlaySeconds) : '…',
              unit: '',
              sub: null,
            },
            {
              label: '推荐位置比例',
              value: !overview
                ? '…'
                : overview.totalPieces > 0
                  ? ((overview.totalFollowed / overview.totalPieces) * 100).toFixed(1)
                  : '暂无数据',
              unit: overview && overview.totalPieces > 0 ? '%' : '',
              sub:
                overview && overview.totalPieces > 0
                  ? `总方块 ${overview.totalPieces} · 推荐 ${overview.totalFollowed}`
                  : null,
            },
          ].map((c) => (
            <div
              key={c.label}
              className="rounded-2xl border border-stone-300 bg-stone-50 p-5 shadow-sm"
            >
              <p className="text-xs font-medium tracking-wider text-stone-400">{c.label}</p>
              {/* 大数字 + 小号单位，基线对齐 */}
              <p className="mt-2 flex items-baseline gap-1.5 whitespace-nowrap">
                <span className="text-3xl font-semibold tabular-nums text-stone-700">
                  {c.value}
                </span>
                {c.unit && <span className="text-sm text-stone-400">{c.unit}</span>}
              </p>
              {c.sub && <p className="mt-1 text-xs whitespace-nowrap text-stone-400">{c.sub}</p>}
            </div>
          ))}
        </div>

        {/* Users table */}
        <div className="mt-6 overflow-hidden rounded-2xl border border-stone-300 bg-stone-50 shadow-sm">
          {loadError && <p className="p-6 text-center text-sm text-red-800/70">{loadError}</p>}
          {!loadError && users === null && (
            <p className="p-6 text-center text-sm text-stone-400">加载中…</p>
          )}
          {!loadError && users !== null && users.length === 0 && (
            <div className="p-10 text-center">
              <p className="text-sm text-stone-500">暂无被试数据</p>
              <p className="mt-1 text-xs text-stone-400">被试注册并游玩后，数据会显示在这里</p>
            </div>
          )}
          {!loadError && users !== null && users.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead className="bg-stone-100">
                  <tr>
                    <th className={`${thCls} w-24`}>编号</th>
                    <th className={thCls}>儿童姓</th>
                    <th className={thCls}>儿童名</th>
                    <th className={thCls}>年龄</th>
                    <th className={thCls}>性别</th>
                    <th className={thCls}>邮箱</th>
                    <th className={thCls}>注册时间</th>
                    <th className={thCls}>游玩次数</th>
                    <th className={thCls}>时长(活跃)</th>
                    <th className={thCls}>方块/推荐</th>
                    <th className={thCls}>最近游玩</th>
                    <th className={thCls}>未上线</th>
                    <th className={thCls}>上次提醒</th>
                    <th className={thStickyCls}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <UserRows
                      key={u.participantId}
                      user={u}
                      expanded={expandedId === u.participantId}
                      sessions={sessions[u.participantId]}
                      onToggle={() => void toggleUser(u.participantId)}
                      onOpenDetail={(id) => void openDetail(id)}
                      onShowDaily={() => setDailyTarget(u)}
                      onEdit={() => setEditTarget(u)}
                      onDelete={() => {
                        setDeleteError('')
                        setDeleteTarget(u)
                      }}
                      tdCls={tdCls}
                      tdNumCls={tdNumCls}
                      stickyShadow={stickyShadow}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Batch import modal */}
      {importOpen && (
        <ImportUsersModal
          token={token}
          onClose={() => setImportOpen(false)}
          onDone={() => {
            setImportOpen(false)
            void reload()
          }}
          onUnauthorized={handleUnauthorized}
        />
      )}

      {/* Send reminders modal */}
      {reminderOpen && (
        <SendRemindersModal
          token={token}
          onClose={() => {
            setReminderOpen(false)
            void reload()
          }}
          onUnauthorized={handleUnauthorized}
        />
      )}

      {/* Daily play detail modal */}
      {dailyTarget && (
        <DailyModal
          user={dailyTarget}
          token={token}
          onClose={() => setDailyTarget(null)}
          onUnauthorized={handleUnauthorized}
        />
      )}

      {/* Edit user modal */}
      {editTarget && (
        <EditUserModal
          user={editTarget}
          token={token}
          onClose={() => setEditTarget(null)}
          onSaved={handleEdited}
          onUnauthorized={handleUnauthorized}
        />
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 p-4"
          onClick={() => !deleteBusy && setDeleteTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-stone-300 bg-stone-50 p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold tracking-wide text-stone-700">
              删除用户 {deleteTarget.participantId}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-stone-500">
              将删除该用户及其全部游玩记录，不可恢复。确定删除「{deleteTarget.childName}」
              的数据吗？
            </p>
            {deleteError && (
              <p className="mt-3 text-center text-sm text-red-800/70">{deleteError}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => setDeleteTarget(null)}
                className="rounded-full border border-stone-300 bg-stone-50 px-4 py-2 text-xs font-medium text-stone-500 transition hover:bg-stone-100 disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => void confirmDelete()}
                className="rounded-full bg-red-800/70 px-4 py-2 text-xs font-medium text-stone-50 transition hover:bg-red-800/80 disabled:opacity-60"
              >
                {deleteBusy ? '删除中…' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Session JSON detail modal */}
      {detail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 p-4"
          onClick={() => setDetail(null)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-stone-300 bg-stone-50 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
              <p className="text-sm font-medium text-stone-600">会话明细 · {detail.sessionId}</p>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="rounded-full border border-stone-300 px-3 py-1 text-xs text-stone-500 transition hover:bg-stone-100"
              >
                关闭
              </button>
            </div>
            <pre className="flex-1 overflow-auto p-5 text-xs leading-relaxed text-stone-600">
              {'loading' in detail ? '加载中…' : JSON.stringify(detail.data, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* User row + expandable sessions                                      */
/* ------------------------------------------------------------------ */
function UserRows({
  user,
  expanded,
  sessions,
  onToggle,
  onOpenDetail,
  onShowDaily,
  onEdit,
  onDelete,
  tdCls,
  tdNumCls,
  stickyShadow,
}: {
  user: AdminUser
  expanded: boolean
  sessions: AdminSessionRow[] | 'loading' | undefined
  onToggle: () => void
  onOpenDetail: (sessionId: string) => void
  onShowDaily: () => void
  onEdit: () => void
  onDelete: () => void
  tdCls: string
  tdNumCls: string
  stickyShadow: string
}) {
  /* 操作列 sticky：常态与表体同色(bg-stone-50)，悬停/展开时与行背景一致 */
  const tdStickyCls = `${tdCls} sticky right-0 ${stickyShadow} ${
    expanded ? 'bg-stone-100' : 'bg-stone-50 group-hover:bg-stone-100'
  }`
  return (
    <>
      <tr
        onClick={onToggle}
        className={`group cursor-pointer border-t border-stone-200 transition hover:bg-stone-100 ${
          expanded ? 'bg-stone-100' : ''
        }`}
      >
        <td className={`${tdCls} w-24 font-medium tabular-nums`}>
          <span className="mr-1 inline-block w-4 text-stone-400">{expanded ? '▾' : '▸'}</span>
          {user.participantId}
        </td>
        <td className={tdCls}>{user.childSurname}</td>
        <td className={tdCls}>{user.childGivenName}</td>
        <td className={tdNumCls}>{user.childAge ?? '—'}</td>
        <td className={tdCls}>{user.childGender}</td>
        {/* 邮箱允许截断，悬停 title 显示全文 */}
        <td className={`${tdCls} max-w-[190px] truncate`} title={user.email}>
          {user.email}
        </td>
        <td className={tdNumCls} title={formatTime(user.registeredAt)}>
          {formatShortTime(user.registeredAt)}
        </td>
        <td className={tdNumCls}>{user.sessionCount} 次</td>
        <td className={tdNumCls}>{formatDuration(user.totalPlaySeconds)}</td>
        <td className={tdNumCls}>
          {user.totalPieces > 0
            ? `${user.totalPieces} / ${user.totalFollowed}（${((user.followedRate ?? 0) * 100).toFixed(1)}%）`
            : '—'}
        </td>
        <td className={tdNumCls} title={formatTime(user.lastPlayedAt)}>
          {formatShortTime(user.lastPlayedAt)}
        </td>
        <td className={tdNumCls}>
          {user.needsReminder ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              {user.daysInactive} 天
            </span>
          ) : (
            `${user.daysInactive} 天`
          )}
        </td>
        <td className={tdNumCls}>{formatShortTime(user.lastReminderAt)}</td>
        <td className={tdStickyCls}>
          {/* 操作列：横向排列，按钮自身不折行；sticky 固定右侧 */}
          <div className="flex items-center gap-2 whitespace-nowrap">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onShowDaily()
              }}
              className="inline-flex items-center whitespace-nowrap rounded-full border border-stone-300 bg-stone-50 px-3 py-1 text-xs text-stone-500 transition-colors hover:bg-stone-100"
            >
              <BarChart3 className="mr-1 h-3.5 w-3.5" />
              详情
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onEdit()
              }}
              className="inline-flex items-center whitespace-nowrap rounded-full border border-stone-300 bg-stone-50 px-3 py-1 text-xs text-stone-500 transition-colors hover:bg-stone-100"
            >
              编辑
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
              className="inline-flex items-center whitespace-nowrap rounded-full border border-red-800/20 px-3 py-1 text-xs text-red-800/70 transition-colors hover:bg-red-800/5"
            >
              删除
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-stone-200 bg-stone-100/60">
          <td colSpan={14} className="px-6 py-4">
            {(!sessions || sessions === 'loading') && (
              <p className="text-xs text-stone-400">会话加载中…</p>
            )}
            {sessions !== 'loading' && sessions && sessions.length === 0 && (
              <p className="text-xs text-stone-400">该被试还没有游玩记录</p>
            )}
            {sessions !== 'loading' && sessions && sessions.length > 0 && (
              /* 会话明细表：全部单元格 nowrap，过宽时横向滚动 */
              <div className="overflow-x-auto rounded-xl border border-stone-200 bg-stone-50">
                <table className="w-full min-w-[760px] border-collapse">
                  <thead className="bg-stone-100">
                    <tr>
                      <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-stone-400">
                        开始时间
                      </th>
                      <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-stone-400">
                        时长(活跃)
                      </th>
                      <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-stone-400">
                        Followed 比率
                      </th>
                      <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-stone-400">
                        是否完成
                      </th>
                      <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-stone-400">
                        上报时间
                      </th>
                      <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-stone-400">
                        明细
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => (
                      <tr key={s.sessionId} className="border-t border-stone-200">
                        <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-stone-600">
                          {formatTime(s.sessionStart)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-stone-600">
                          {formatDuration(s.durationSec)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-stone-600">
                          {s.followedTotal > 0
                            ? `${s.followed}/${s.followedTotal}（${Math.round((s.followed / s.followedTotal) * 100)}%）`
                            : '—'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs">
                          {s.completed ? (
                            <span className="rounded-full bg-stone-300/70 px-2 py-0.5 text-stone-600">
                              已完成
                            </span>
                          ) : (
                            <span className="rounded-full bg-stone-200 px-2 py-0.5 text-stone-400">
                              未完成
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-stone-600">
                          {formatTime(s.receivedAt)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              onOpenDetail(s.sessionId)
                            }}
                            className="inline-flex items-center whitespace-nowrap rounded-full border border-stone-300 bg-stone-50 px-3 py-1 text-stone-500 transition-colors hover:bg-stone-100"
                          >
                            查看 JSON
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Daily play detail modal (chart + table)                             */
/* ------------------------------------------------------------------ */
/** 莫兰迪系低饱和堆叠色：灰蓝 / 灰粉 / 灰绿 */
const DAILY_COLORS = ['#a9becb', '#d3afaf', '#b7c4a9'] as const

/** 图表行：秒 → 分钟（保留 1 位小数），同时保留原始秒数给 Tooltip */
interface DailyChartRow {
  label: string
  b1: number
  b2: number
  b3: number
  totalSeconds: number
}

function DailyTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0].payload as DailyChartRow
  return (
    <div className="rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-xs shadow-sm">
      <p className="font-medium tabular-nums text-stone-600">{row.label}</p>
      {(['b1', 'b2', 'b3'] as const).map((k, i) => (
        <p key={k} className="mt-1 flex items-center gap-1.5 tabular-nums text-stone-500">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: DAILY_COLORS[i] }}
          />
          第{i + 1}轮：{row[k].toFixed(1)} 分钟
        </p>
      ))}
      <p className="mt-1 border-t border-stone-200 pt-1 tabular-nums text-stone-600">
        总时长：{formatDuration(row.totalSeconds)}
      </p>
    </div>
  )
}

function DailyModal({
  user,
  token,
  onClose,
  onUnauthorized,
}: {
  user: AdminUser
  token: string
  onClose: () => void
  onUnauthorized: () => void
}) {
  const [days, setDays] = useState<DailyRow[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const r = await getUserDaily(token, user.participantId)
      if (cancelled) return
      if (r.ok) {
        setDays(r.data.days)
        return
      }
      if (r.unauthorized) {
        onUnauthorized()
        return
      }
      setError(r.error) // 404 用户不存在 / 网络错误等
    })()
    return () => {
      cancelled = true
    }
  }, [token, user.participantId, onUnauthorized])

  const chartData: DailyChartRow[] = (days ?? []).map((d) => ({
    label: d.date.slice(5).replace('-', '/'), // YYYY-MM-DD → MM/DD
    b1: Math.round((d.block1Seconds / 60) * 10) / 10,
    b2: Math.round((d.block2Seconds / 60) * 10) / 10,
    b3: Math.round((d.block3Seconds / 60) * 10) / 10,
    totalSeconds: d.totalSeconds,
  }))

  const totals = (days ?? []).reduce(
    (acc, d) => ({
      b1: acc.b1 + d.block1Seconds,
      b2: acc.b2 + d.block2Seconds,
      b3: acc.b3 + d.block3Seconds,
      total: acc.total + d.totalSeconds,
      sessions: acc.sessions + d.sessionCount,
    }),
    { b1: 0, b2: 0, b3: 0, total: 0, sessions: 0 },
  )

  const thCls =
    'whitespace-nowrap px-3 py-2 text-left text-xs font-medium tracking-wider text-stone-400'
  const tdCls = 'whitespace-nowrap px-3 py-2 text-sm tabular-nums text-stone-600'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-stone-900/30 p-4"
      onClick={onClose}
    >
      <div
        className="my-auto w-full max-w-3xl rounded-2xl border border-stone-300 bg-stone-50 p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-wide text-stone-700">
            游玩情况 · {user.participantId} {user.childName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-stone-300 px-3 py-1 text-xs text-stone-500 transition hover:bg-stone-100"
          >
            关闭
          </button>
        </div>

        {days === null && !error && (
          <p className="py-16 text-center text-sm text-stone-400">加载中…</p>
        )}

        {error && <p className="py-16 text-center text-sm text-red-800/70">{error}</p>}

        {days !== null && days.length === 0 && !error && (
          <div className="py-16 text-center">
            <p className="text-sm text-stone-500">暂无游玩记录</p>
            <p className="mt-1 text-xs text-stone-400">该被试完成游玩后，每日数据会显示在这里</p>
          </div>
        )}

        {days !== null && days.length > 0 && (
          <>
            {/* 堆叠柱状图：第1/2/3轮分钟数 */}
            <div className="mt-4 h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: '#78716c' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#78716c' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `${v}分`}
                  />
                  <Tooltip content={<DailyTooltip />} cursor={{ fill: 'rgba(68,64,60,0.06)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="b1" name="第1轮" stackId="play" fill={DAILY_COLORS[0]} />
                  <Bar dataKey="b2" name="第2轮" stackId="play" fill={DAILY_COLORS[1]} />
                  <Bar
                    dataKey="b3"
                    name="第3轮"
                    stackId="play"
                    fill={DAILY_COLORS[2]}
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* 明细表：全部 nowrap + tabular-nums，过宽横向滚动 */}
            <div className="mt-4 overflow-x-auto rounded-xl border border-stone-200 bg-white">
              <table className="w-full border-collapse">
                <thead className="bg-stone-100">
                  <tr>
                    <th className={thCls}>日期</th>
                    <th className={thCls}>第1轮</th>
                    <th className={thCls}>第2轮</th>
                    <th className={thCls}>第3轮</th>
                    <th className={thCls}>总时长</th>
                    <th className={thCls}>次数</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.date} className="border-t border-stone-200">
                      <td className={tdCls} title={d.date}>
                        {d.date.slice(5)}
                      </td>
                      <td className={tdCls}>{formatDuration(d.block1Seconds)}</td>
                      <td className={tdCls}>{formatDuration(d.block2Seconds)}</td>
                      <td className={tdCls}>{formatDuration(d.block3Seconds)}</td>
                      <td className={tdCls}>{formatDuration(d.totalSeconds)}</td>
                      <td className={tdCls}>{d.sessionCount} 次</td>
                    </tr>
                  ))}
                  <tr className="border-t border-stone-200 bg-stone-100/60 font-semibold">
                    <td className={`${tdCls} text-stone-700`}>合计</td>
                    <td className={`${tdCls} text-stone-700`}>{formatDuration(totals.b1)}</td>
                    <td className={`${tdCls} text-stone-700`}>{formatDuration(totals.b2)}</td>
                    <td className={`${tdCls} text-stone-700`}>{formatDuration(totals.b3)}</td>
                    <td className={`${tdCls} text-stone-700`}>{formatDuration(totals.total)}</td>
                    <td className={`${tdCls} text-stone-700`}>{totals.sessions} 次</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Edit user modal                                                     */
/* ------------------------------------------------------------------ */
function EditUserModal({
  user,
  token,
  onClose,
  onSaved,
  onUnauthorized,
}: {
  user: AdminUser
  token: string
  onClose: () => void
  onSaved: () => void
  onUnauthorized: () => void
}) {
  const [participantId, setParticipantId] = useState(user.participantId)
  const [childSurname, setChildSurname] = useState(user.childSurname)
  const [childGivenName, setChildGivenName] = useState(user.childGivenName)
  const [childAge, setChildAge] = useState(user.childAge === null ? '' : String(user.childAge))
  const [childGender, setChildGender] = useState(user.childGender)
  const [email, setEmail] = useState(user.email)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const labelCls = 'mt-3 mb-1.5 block text-xs font-medium tracking-wider text-stone-500'
  const inputCls =
    'w-full rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm text-stone-700 outline-none focus:border-stone-400'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const pid = participantId.trim()
    if (!/^\d{4}$/.test(pid)) {
      setError('被试编号为 4 位数字，如 0101')
      return
    }
    if (!childSurname.trim()) {
      setError('请输入儿童姓')
      return
    }
    if (!childGivenName.trim()) {
      setError('请输入儿童名')
      return
    }
    const ageText = childAge.trim()
    let age: number | null = null
    if (ageText !== '') {
      if (!/^\d+$/.test(ageText)) {
        setError('年龄请填写数字，或留空')
        return
      }
      age = Number(ageText)
    }
    if (!childGender) {
      setError('请选择小孩性别')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('请输入正确的邮箱地址')
      return
    }
    setBusy(true)
    setError('')
    const r = await adminUpdateUser(token, user.participantId, {
      participantId: pid,
      childSurname: childSurname.trim(),
      childGivenName: childGivenName.trim(),
      childAge: age,
      childGender,
      email: email.trim(),
    })
    setBusy(false)
    if (r.ok) {
      onSaved()
      return
    }
    if (r.unauthorized) {
      onUnauthorized()
      return
    }
    setError(r.error) // 409 该编号已被使用 / 400 校验失败等
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-stone-900/30 p-4"
      onClick={() => !busy && onClose()}
    >
      <form
        onSubmit={submit}
        className="my-auto w-full max-w-sm rounded-2xl border border-stone-300 bg-stone-50 p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold tracking-wide text-stone-700">
          编辑用户 {user.participantId}
        </h2>

        <label className={labelCls}>被试编号</label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={4}
          value={participantId}
          onChange={(e) => setParticipantId(e.target.value.replace(/\D/g, '').slice(0, 4))}
          className={inputCls}
        />
        <p className="mt-1 text-xs text-stone-400">登录凭证 = 编号 + 儿童姓，如 0101张</p>

        <label className={labelCls}>儿童姓</label>
        <input
          type="text"
          placeholder="如：张"
          value={childSurname}
          onChange={(e) => setChildSurname(e.target.value)}
          className={inputCls}
        />

        <label className={labelCls}>儿童名</label>
        <input
          type="text"
          placeholder="如：三"
          value={childGivenName}
          onChange={(e) => setChildGivenName(e.target.value)}
          className={inputCls}
        />

        <label className={labelCls}>年龄（可留空）</label>
        <input
          type="text"
          inputMode="numeric"
          placeholder="数字，可留空"
          value={childAge}
          onChange={(e) => setChildAge(e.target.value.replace(/\D/g, '').slice(0, 3))}
          className={inputCls}
        />

        <span className={labelCls}>小孩性别</span>
        <div className="flex gap-2" role="radiogroup" aria-label="小孩性别">
          {['男', '女'].map((g) => (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={childGender === g}
              onClick={() => setChildGender(g)}
              className={`flex-1 rounded-xl border px-4 py-2 text-sm transition ${
                childGender === g
                  ? 'border-stone-400 bg-stone-300/70 text-stone-700'
                  : 'border-stone-300 bg-white text-stone-400 hover:bg-stone-100'
              }`}
            >
              {g}
            </button>
          ))}
        </div>

        <label className={labelCls}>邮箱</label>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
        />

        {error && <p className="mt-3 text-center text-sm text-red-800/70">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-full border border-stone-300 bg-stone-50 px-4 py-2 text-xs font-medium text-stone-500 transition hover:bg-stone-100 disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-stone-500 px-4 py-2 text-xs font-medium text-stone-50 transition hover:bg-stone-600 disabled:opacity-60"
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Batch import modal (xlsx → preview → import → result)               */
/* ------------------------------------------------------------------ */
interface ParsedImportRow extends ImportUserItem {
  /** 1-based data row number (header excluded) for preview display */
  rowNo: number
}

type ImportStage =
  | { step: 'pick' }
  | { step: 'preview'; rows: ParsedImportRow[]; fileName: string }
  | { step: 'result'; imported: number; failed: ImportFailure[] }

/* 表头别名：统一 trim + 小写后匹配 */
const HEADER_ALIASES: Record<'id' | 'name' | 'age' | 'gender' | 'email', string[]> = {
  id: ['id编号', '编号', 'id', 'id 编号', '被试编号'],
  name: ['儿童姓名', '姓名', '儿童名', '小孩姓名', '孩子姓名'],
  age: ['儿童年龄', '年龄'],
  gender: ['儿童性别', '性别'],
  email: ['联系邮箱', '邮箱', '电子邮箱', 'email', 'e-mail'],
}

function normalizeGender(v: unknown): string {
  const s = String(v ?? '').trim()
  const low = s.toLowerCase()
  if (s === '男' || low === 'm' || low === 'male') return '男'
  if (s === '女' || low === 'f' || low === 'female') return '女'
  return s
}

function normalizeAge(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null
  const s = String(v).trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n) : null
}

/** 编号保留前导零：字符串 trim 后直接用；数字补零到 4 位 */
function normalizeId(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v).padStart(4, '0')
  return String(v ?? '').trim()
}

async function parseXlsxFile(file: File): Promise<ParsedImportRow[]> {
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  let wb
  try {
    wb = XLSX.read(buf, { type: 'array' })
  } catch {
    throw new Error('文件解析失败，请确认是有效的 .xlsx 文件')
  }
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) throw new Error('文件中没有可用的工作表')
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false,
  })
  if (grid.length === 0) throw new Error('文件内容为空')

  const headers = grid[0].map((h) => String(h ?? '').trim().toLowerCase())
  const colOf = (key: keyof typeof HEADER_ALIASES) =>
    headers.findIndex((h) => HEADER_ALIASES[key].includes(h))
  const cols = { id: colOf('id'), name: colOf('name'), age: colOf('age'), gender: colOf('gender'), email: colOf('email') }
  const missing: string[] = []
  if (cols.id < 0) missing.push('ID编号')
  if (cols.name < 0) missing.push('儿童姓名')
  if (cols.gender < 0) missing.push('儿童性别')
  if (cols.email < 0) missing.push('联系邮箱')
  if (missing.length > 0) {
    throw new Error(`表头缺失：${missing.join('、')}。需要表头「ID编号 | 儿童姓名 | 儿童年龄 | 儿童性别 | 联系邮箱」`)
  }

  const rows: ParsedImportRow[] = []
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i]
    const id = normalizeId(r[cols.id])
    const name = String(r[cols.name] ?? '').trim()
    const age = cols.age >= 0 ? normalizeAge(r[cols.age]) : null
    const gender = normalizeGender(r[cols.gender])
    const email = String(r[cols.email] ?? '').trim()
    if (!id && !name && !gender && !email && age === null) continue // 跳过全空行
    rows.push({ rowNo: i, participantId: id, childName: name, childAge: age, childGender: gender, email })
  }
  if (rows.length === 0) throw new Error('未解析到任何数据行')
  return rows
}

function ImportUsersModal({
  token,
  onClose,
  onDone,
  onUnauthorized,
}: {
  token: string
  onClose: () => void
  onDone: () => void
  onUnauthorized: () => void
}) {
  const [stage, setStage] = useState<ImportStage>({ step: 'pick' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  const btnOutlineCls =
    'rounded-full border border-stone-300 bg-stone-50 px-4 py-2 text-xs font-medium text-stone-500 transition hover:bg-stone-100 disabled:opacity-60'
  const btnSolidCls =
    'rounded-full bg-stone-500 px-4 py-2 text-xs font-medium text-stone-50 transition hover:bg-stone-600 disabled:opacity-60'

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    if (!/\.xlsx$/i.test(file.name)) {
      setError('请选择 .xlsx 格式的文件')
      return
    }
    setBusy(true)
    setError('')
    try {
      const rows = await parseXlsxFile(file)
      setStage({ step: 'preview', rows, fileName: file.name })
    } catch (err) {
      setError(err instanceof Error ? err.message : '文件解析失败，请检查文件格式')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const confirmImport = async (rows: ParsedImportRow[]) => {
    setBusy(true)
    setError('')
    const r = await importUsers(
      token,
      rows.map(({ participantId, childName, childAge, childGender, email }) => ({
        participantId,
        childName,
        childAge,
        childGender,
        email,
      })),
    )
    setBusy(false)
    if (r.ok) {
      setStage({ step: 'result', imported: r.data.imported, failed: r.data.failed })
      return
    }
    if (r.unauthorized) {
      onUnauthorized()
      return
    }
    setError(r.error)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-stone-900/30 p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        className="my-auto w-full max-w-2xl rounded-2xl border border-stone-300 bg-stone-50 p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold tracking-wide text-stone-700">批量导入用户</h2>

        {stage.step === 'pick' && (
          <>
            <p className="mt-2 text-sm leading-relaxed text-stone-500">
              请选择 .xlsx 文件，第一个工作表的表头需为
              「ID编号 | 儿童姓名 | 儿童年龄 | 儿童性别 | 联系邮箱」。
            </p>
            <div className="mt-5 flex items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => void handleFile(e.target.files?.[0])}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                className={btnSolidCls}
              >
                {busy ? '解析中…' : '选择文件'}
              </button>
              <span className="text-xs text-stone-400">编号会保留前导零，如 0002</span>
            </div>
          </>
        )}

        {stage.step === 'preview' && (
          <>
            <p className="mt-2 text-sm text-stone-500">
              已解析 <span className="font-medium text-stone-700">{stage.fileName}</span>，共{' '}
              <span className="font-medium tabular-nums text-stone-700">{stage.rows.length}</span>{' '}
              行，请确认后导入：
            </p>
            <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-stone-200 bg-white">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-stone-100">
                  <tr>
                    {['行', '编号', '儿童姓名', '年龄', '性别', '邮箱'].map((h) => (
                      <th
                        key={h}
                        className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium tracking-wider text-stone-400"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stage.rows.map((r, i) => (
                    <tr key={i} className="border-t border-stone-200">
                      <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-stone-400">
                        {r.rowNo + 1}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm font-medium tabular-nums text-stone-600">
                        {r.participantId || '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-stone-600">
                        {r.childName || '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm tabular-nums text-stone-600">
                        {r.childAge ?? '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-stone-600">
                        {r.childGender || '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-stone-600">
                        {r.email || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {stage.step === 'result' && (
          <div className="mt-3">
            <p className="text-sm text-stone-600">
              导入完成：成功{' '}
              <span className="font-medium tabular-nums text-stone-700">{stage.imported}</span> 条
              {stage.failed.length > 0 && (
                <>
                  ，失败{' '}
                  <span className="font-medium tabular-nums text-red-800/70">
                    {stage.failed.length}
                  </span>{' '}
                  条
                </>
              )}
              。
            </p>
            {stage.failed.length > 0 && (
              <ul className="mt-3 max-h-56 space-y-1.5 overflow-auto rounded-xl border border-red-800/15 bg-red-800/5 p-3">
                {stage.failed.map((f, i) => (
                  <li key={i} className="text-xs leading-relaxed text-red-800/70">
                    第 {f.index + 1} 行 · {f.participantId || '—'} · {f.childName || '—'}：
                    {f.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && <p className="mt-3 text-center text-sm text-red-800/70">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          {stage.step === 'pick' && (
            <button type="button" disabled={busy} onClick={onClose} className={btnOutlineCls}>
              取消
            </button>
          )}
          {stage.step === 'preview' && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setError('')
                  setStage({ step: 'pick' })
                }}
                className={btnOutlineCls}
              >
                重新选择
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmImport(stage.rows)}
                className={btnSolidCls}
              >
                {busy ? '导入中…' : '确认导入'}
              </button>
            </>
          )}
          {stage.step === 'result' && (
            <button type="button" onClick={onDone} className={btnSolidCls}>
              完成
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Send reminders modal (confirm → send → result)                      */
/* ------------------------------------------------------------------ */
type ReminderStage = { step: 'confirm' } | { step: 'result'; data: SendRemindersData }

function SendRemindersModal({
  token,
  onClose,
  onUnauthorized,
}: {
  token: string
  onClose: () => void
  onUnauthorized: () => void
}) {
  const [stage, setStage] = useState<ReminderStage>({ step: 'confirm' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const btnOutlineCls =
    'rounded-full border border-stone-300 bg-stone-50 px-4 py-2 text-xs font-medium text-stone-500 transition hover:bg-stone-100 disabled:opacity-60'
  const btnSolidCls =
    'rounded-full bg-stone-500 px-4 py-2 text-xs font-medium text-stone-50 transition hover:bg-stone-600 disabled:opacity-60'

  const confirmSend = async () => {
    setBusy(true)
    setError('')
    const r = await sendReminders(token)
    setBusy(false)
    if (r.ok) {
      setStage({ step: 'result', data: r.data })
      return
    }
    if (r.unauthorized) {
      onUnauthorized()
      return
    }
    setError(r.error) // 503 邮件服务未配置等后端文案
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-stone-900/30 p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        className="my-auto w-full max-w-lg rounded-2xl border border-stone-300 bg-stone-50 p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold tracking-wide text-stone-700">发送提醒邮件</h2>

        {stage.step === 'confirm' && (
          <p className="mt-2 text-sm leading-relaxed text-stone-500">
            将向所有满 3 天未登录游戏的用户发送提醒邮件，确认发送？
          </p>
        )}

        {stage.step === 'result' && (
          <div className="mt-3">
            <p className="text-sm text-stone-600">
              发送完成：成功{' '}
              <span className="font-medium tabular-nums text-stone-700">
                {stage.data.sent.length}
              </span>{' '}
              封
              {stage.data.failed.length > 0 && (
                <>
                  ，失败{' '}
                  <span className="font-medium tabular-nums text-red-800/70">
                    {stage.data.failed.length}
                  </span>{' '}
                  封
                </>
              )}
              。
            </p>

            {stage.data.sent.length > 0 && (
              <ul className="mt-3 max-h-48 space-y-1.5 overflow-auto rounded-xl border border-stone-200 bg-white p-3">
                {stage.data.sent.map((s) => (
                  <li
                    key={s.participantId}
                    className="whitespace-nowrap text-xs leading-relaxed text-stone-600"
                  >
                    <span className="font-medium tabular-nums">{s.participantId}</span> ·{' '}
                    {s.childName} · <span className="text-stone-400">{s.email}</span>
                  </li>
                ))}
              </ul>
            )}

            {stage.data.failed.length > 0 && (
              <ul className="mt-3 max-h-48 space-y-1.5 overflow-auto rounded-xl border border-red-800/15 bg-red-800/5 p-3">
                {stage.data.failed.map((f) => (
                  <li
                    key={f.participantId}
                    className="text-xs leading-relaxed text-red-800/70"
                  >
                    <span className="font-medium tabular-nums">{f.participantId}</span> ·{' '}
                    {f.childName} · {f.email}：{f.reason}
                  </li>
                ))}
              </ul>
            )}

            {stage.data.skipped > 0 && (
              <p className="mt-3 text-xs text-stone-400">
                其余 {stage.data.skipped} 位用户不满足提醒条件（未满 3 天或 72 小时内已提醒）
              </p>
            )}
          </div>
        )}

        {error && <p className="mt-3 text-center text-sm text-red-800/70">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          {stage.step === 'confirm' && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={onClose}
                className={btnOutlineCls}
              >
                取消
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmSend()}
                className={btnSolidCls}
              >
                {busy ? '发送中…' : '确认发送'}
              </button>
            </>
          )}
          {stage.step === 'result' && (
            <button type="button" onClick={onClose} className={btnSolidCls}>
              完成
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
