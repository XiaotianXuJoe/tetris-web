/**
 * Experiment session log — in-memory + localStorage, downloadable as JSON.
 * No backend; the 3-day-inactivity parent reminder is a server-side feature
 * and is recorded here only as a placeholder field.
 */

export interface PieceRecord {
  at: string
  piece: string
  orientation: string
  ghostCol: number
  lockedCol: number
  followed: boolean
}

export interface SessionLog {
  mode: 'watch' | 'play' | null
  /** Fixed speed gradient: seconds for a piece to fall the full board height per block. */
  speedSetting: {
    label: string
    fullDescentSeconds: [number, number, number]
  }
  Time: {
    sessionStart: string | null
    rests: { index: number; start: string; end: string | null }[]
    pauses: { start: string; end: string | null }[]
    sessionEnd: string | null
  }
  /** Actual runtime (seconds) of each play block. */
  Training: {
    block1Seconds: number | null
    block2Seconds: number | null
    block3Seconds: number | null
  }
  Followed: {
    followed: number
    total: number
    pieces: PieceRecord[]
  }
  parentReminder: string
}

const STORAGE_KEY = 'tetris-adhd-control-session-log'

function freshLog(): SessionLog {
  return {
    mode: null,
    speedSetting: {
      label: '固定梯度：方块从顶部落到底部的时间 Block1/2/3 = 10s/8s/5s',
      fullDescentSeconds: [10, 8, 5],
    },
    Time: { sessionStart: null, rests: [], pauses: [], sessionEnd: null },
    Training: { block1Seconds: null, block2Seconds: null, block3Seconds: null },
    Followed: { followed: 0, total: 0, pieces: [] },
    parentReminder:
      '3天未活动时的家长提醒（微信/短信）为服务端功能，纯前端无法实现——此字段为记录字段占位。',
  }
}

let log: SessionLog = freshLog()

try {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw) log = JSON.parse(raw) as SessionLog
} catch {
  /* ignore corrupted storage */
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log))
  } catch {
    /* storage unavailable */
  }
}

export function startSession(mode: 'watch' | 'play'): void {
  log = freshLog()
  log.mode = mode
  log.Time.sessionStart = new Date().toISOString()
  persist()
}

export function recordRestStart(index: number): void {
  log.Time.rests.push({ index, start: new Date().toISOString(), end: null })
  persist()
}

export function recordRestEnd(index: number): void {
  const rest = log.Time.rests.find((r) => r.index === index)
  if (rest) rest.end = new Date().toISOString()
  persist()
}

export function recordPauseStart(): void {
  log.Time.pauses.push({ start: new Date().toISOString(), end: null })
  persist()
}

export function recordPauseEnd(): void {
  const pause = [...log.Time.pauses].reverse().find((p) => p.end === null)
  if (pause) pause.end = new Date().toISOString()
  persist()
}

export function recordBlock(block: 1 | 2 | 3, seconds: number): void {
  const key = `block${block}Seconds` as 'block1Seconds' | 'block2Seconds' | 'block3Seconds'
  log.Training[key] = Math.round(seconds * 10) / 10
  persist()
}

/**
 * Best-effort snapshot of a block that is still in progress (user may close
 * the page / restart / log out before endBlock runs). Writes ONLY while the
 * field is still null — a fully recorded block (recordBlock) is never
 * overwritten, and recordBlock itself assigns directly, so a later complete
 * value cleanly replaces this partial one (no double counting).
 */
export function recordBlockPartial(block: 1 | 2 | 3, seconds: number): void {
  const key = `block${block}Seconds` as 'block1Seconds' | 'block2Seconds' | 'block3Seconds'
  if (log.Training[key] !== null) return
  log.Training[key] = Math.round(seconds * 10) / 10
  persist()
}

export function recordPiece(rec: Omit<PieceRecord, 'at'>): void {
  log.Followed.total += 1
  if (rec.followed) log.Followed.followed += 1
  log.Followed.pieces.push({ ...rec, at: new Date().toISOString() })
  persist()
}

export function endSession(): void {
  log.Time.sessionEnd = new Date().toISOString()
  persist()
}

export function getLog(): SessionLog {
  return log
}

/** Download the full session log as a JSON file. */
export function downloadLog(): void {
  const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `tetris-session-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 5000)
}
