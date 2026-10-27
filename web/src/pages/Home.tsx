import { useEffect, useRef, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { COLS, ROWS, emptyGrid, fits, fullRows, landRow, recommend } from '@/game/engine'
import type { Grid } from '@/game/engine'
import { PIECE_STYLE, randomShape } from '@/game/pieces'
import type { PieceKind, PieceShape } from '@/game/pieces'
import {
  initAudio,
  playFollowed,
  playLanding,
  playLineClear,
  resumeAudio,
  setMuted,
  startFallingChirp,
  stopFallingChirp,
  suspendAudio,
} from '@/game/audio'
import * as sesslog from '@/game/log'
import type { SessionLog } from '@/game/log'
import {
  appendPendingUpload,
  clearAuth,
  loadAuth,
  loadPendingUploads,
  savePendingUploads,
  uploadSession,
} from '@/api'
import type { User } from '@/api'
import Auth from '@/pages/Auth'

/* ------------------------------------------------------------------ */
/* Experiment constants                                                */
/* ------------------------------------------------------------------ */
const BLOCK_LEN = 360 // 6:00 per play block (active seconds)
const REST_LEN = 60 // 1:00 rest (wall clock)
const STAR_STEP = 180 // one star per 3:00 of active play
/* Fixed speed gradient — tied to the experiment phase only, never to
   player performance. DESCENT_TIMES[b] = seconds for a piece to fall
   the FULL board height (top → bottom) in block b+1. Fall speed is a
   FIXED constant per block (SPEEDS). The inactivity auto-adopt threshold
   is derived dynamically per piece from its natural landing time. */
const DESCENT_TIMES: [number, number, number] = [10, 8, 5]
const SPEEDS = DESCENT_TIMES.map((t) => ROWS / t) // rows per second, blocks 1/2/3 (fixed)
const GLIDE_TIME = 0.7 // seconds — horizontal glide + fast-drop duration on auto-adopt

type Phase = 'intro' | 'playing' | 'resting' | 'finished'

/** A log worth uploading: at least one piece locked or one block timed. */
function logHasSubstance(log: SessionLog): boolean {
  return (
    log.Followed.total > 0 ||
    log.Training.block1Seconds !== null ||
    log.Training.block2Seconds !== null ||
    log.Training.block3Seconds !== null
  )
}

interface SettledCell {
  id: number
  row: number
  col: number
  kind: PieceKind
  fading: boolean
}

interface ActivePiece {
  id: number
  shape: PieceShape
  x: number
  ghostX: number
  ghostY: number
  xEase: 'slide' | 'glide'
}

function buildGrid(cells: SettledCell[]): Grid {
  const g = emptyGrid()
  for (const c of cells) {
    if (c.row >= 0 && c.row < ROWS && c.col >= 0 && c.col < COLS) g[c.row][c.col] = c.kind
  }
  return g
}

/* ------------------------------------------------------------------ */
/* Star SVG                                                            */
/* ------------------------------------------------------------------ */
const STAR_POINTS = (() => {
  const cx = 14
  const cy = 14
  const outer = 11
  const inner = 4.9
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`)
  }
  return pts.join(' ')
})()

function Star({ lit, size = 28 }: { lit: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      className={lit ? 'star lit' : 'star'}
      aria-hidden="true"
    >
      <polygon points={STAR_POINTS} strokeLinejoin="round" className="star-shape" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* Overlays                                                            */
/* ------------------------------------------------------------------ */
function IntroVeil({
  leaving,
  hasPaused,
  onStart,
  onResume,
}: {
  leaving: boolean
  hasPaused: boolean
  onStart: () => void
  onResume: () => void
}) {
  return (
    <div className={leaving ? 'veil veil-out-fast' : 'veil veil-in-fast'}>
      <div className="intro-card">
        <h1 className="intro-title">小遊戲時間</h1>
        <p className="intro-sub">{hasPaused ? '歡迎回來' : '準備好了嗎'}</p>
        <div className="intro-buttons">
          {hasPaused ? (
            <>
              <button
                type="button"
                className="mode-btn mode-play"
                style={{ animationDelay: '300ms' }}
                onClick={onResume}
              >
                <span>繼續遊戲</span>
                <span className="mode-btn-note">從剛才暫停的地方接著玩</span>
              </button>
              <button
                type="button"
                className="mode-btn mode-watch"
                style={{ animationDelay: '400ms' }}
                onClick={onStart}
              >
                <span>重新開始</span>
                <span className="mode-btn-note">放棄當前進度，從第一階段開始</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              className="mode-btn mode-play"
              style={{ animationDelay: '300ms' }}
              onClick={onStart}
            >
              <span>開始遊戲</span>
              <span className="mode-btn-note">輕點螢幕左右兩側，幫方塊選位置</span>
            </button>
          )}
        </div>
        <p className="intro-hint">
          方塊會從中間慢慢落下，虛線是它的推薦位置；輕點螢幕兩側可以幫它選位置，不點也沒關係
        </p>
      </div>
    </div>
  )
}

function RestVeil({ leaving }: { leaving: boolean }) {
  const [fill, setFill] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setFill(true), 80)
    return () => window.clearTimeout(t)
  }, [])
  return (
    <div className={leaving ? 'veil veil-out' : 'veil veil-in'}>
      <div className="veil-content">
        <svg className="moon" width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
          <path d="M30.5 4.5 A17.5 17.5 0 1 0 30.5 35.5 A14 14 0 1 1 30.5 4.5 Z" fill="#C9BFB4" />
          <circle cx="12.5" cy="11" r="1.6" fill="#D8CBA8" />
        </svg>
        <h1 className="rest-title">請休息</h1>
        <p className="rest-sub">閉上眼睛，深呼吸，一分鐘後繼續</p>
        <div className="rest-track">
          <div className="rest-fill" style={{ width: fill ? '100%' : '0%' }} />
        </div>
      </div>
    </div>
  )
}

function EndVeil({ onExport }: { onExport: () => void }) {
  return (
    <div className="veil veil-in-slow">
      <div className="veil-content" style={{ animationDelay: '0ms' }}>
        <div className="end-stars">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="star-in" style={{ animationDelay: `${i * 80}ms` }}>
              <Star lit size={20} />
            </span>
          ))}
        </div>
        <h1 className="end-title">謝謝參與</h1>
        <p className="end-sub">你做得很好，實驗結束了 ♡</p>
      </div>
      <button type="button" className="export-btn" onClick={onExport}>
        匯出數據
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Main page                                                           */
/* ------------------------------------------------------------------ */
export default function Home() {
  const [user, setUser] = useState<User | null>(() => loadAuth()?.user ?? null)
  const [phase, setPhase] = useState<Phase>('intro')
  const [cells, setCells] = useState<SettledCell[]>([])
  const [piece, setPiece] = useState<ActivePiece | null>(null)
  const [litStars, setLitStars] = useState(0)
  const [started, setStarted] = useState(false)
  const [introLeaving, setIntroLeaving] = useState(false)
  const [restLeaving, setRestLeaving] = useState(false)
  const [restKey, setRestKey] = useState(0)
  const [endStage, setEndStage] = useState(0)
  const [hintOn, setHintOn] = useState(false)
  const [bgAlt, setBgAlt] = useState(false)
  const [hasPaused, setHasPaused] = useState(false)
  /* v2.1 音效开关：偏好持久化在 localStorage，默认开 */
  const [muted, setMutedState] = useState(
    () => localStorage.getItem('tetris-adhd-muted') === '1',
  )
  useEffect(() => {
    setMuted(muted)
    localStorage.setItem('tetris-adhd-muted', muted ? '1' : '0')
  }, [muted])

  const phaseRef = useRef(phase)
  const blockRef = useRef<1 | 2 | 3>(1)
  const cellsRef = useRef(cells)
  const pieceRef = useRef(piece)
  const litRef = useRef(0)
  const idRef = useRef(1)
  const yRef = useRef(0)
  const idleRef = useRef(0) // seconds since last player operation (or spawn)
  const glidedRef = useRef(false)
  const landRef = useRef(0)
  const adoptSpeedRef = useRef(0) // fast-drop speed during the drop phase of auto-adopt
  const adoptTimeRef = useRef(0) // elapsed seconds since auto-adopt started
  const activeTimeRef = useRef(0)
  const blockTimeRef = useRef(0)
  const pausedPhaseRef = useRef<'playing' | 'resting'>('playing')
  const restStartRef = useRef(0)
  const restRemainRef = useRef(0)
  const yElRef = useRef<HTMLDivElement | null>(null)
  const timersRef = useRef<number[]>([])
  const restTimersRef = useRef<number[]>([])

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  /**
   * Snapshot the currently-running block's active seconds into the log
   * (partial record) so an early exit doesn't lose the elapsed play time.
   * Only meaningful while a block is genuinely in progress: `playing`, or
   * the pause-intro of a `playing` block (「重新开始」reports the old log
   * from there). During `resting` the block has already been recorded in
   * full by endBlock and blockTimeRef is 0, so this is a no-op; it is also
   * a no-op once every block is recorded (recordBlockPartial never
   * overwrites a non-null field).
   */
  const recordPartialBlock = () => {
    const inProgress =
      phaseRef.current === 'playing' ||
      (phaseRef.current === 'intro' && hasPaused && pausedPhaseRef.current === 'playing')
    if (!inProgress) return
    if (blockTimeRef.current <= 0) return
    sesslog.recordBlockPartial(blockRef.current, blockTimeRef.current)
  }

  /* -------------------------------------------------------------- */
  /* Session upload — report logs to the backend, retry on failure  */
  /* -------------------------------------------------------------- */
  const reportLog = async (log: SessionLog) => {
    const auth = loadAuth()
    if (!auth) return
    const r = await uploadSession(auth.token, log)
    if (r === 'ok') return
    if (r === 'unauthorized') {
      // Token expired → drop local auth, back to the login screen.
      clearAuth()
      setUser(null)
      return
    }
    appendPendingUpload(log) // network/server failure → retry later
  }

  /* Retry logs that failed to upload earlier (on mount + network recovery). */
  useEffect(() => {
    let cancelled = false
    const retryPending = async () => {
      const auth = loadAuth()
      if (!auth) return
      const pendings = loadPendingUploads()
      if (pendings.length === 0) return
      const remaining: SessionLog[] = []
      for (const log of pendings) {
        const r = await uploadSession(auth.token, log)
        if (cancelled) return
        if (r === 'ok') continue
        if (r === 'unauthorized') {
          clearAuth()
          savePendingUploads([])
          setUser(null)
          return
        }
        remaining.push(log) // still failing — keep for the next attempt
      }
      savePendingUploads(remaining)
    }
    void retryPending()
    const onOnline = () => void retryPending()
    window.addEventListener('online', onOnline)
    return () => {
      cancelled = true
      window.removeEventListener('online', onOnline)
    }
  }, [])

  /* Best-effort report when the page is closed or hidden mid-session.
     fetch keepalive is used because sendBeacon cannot set headers. */
  useEffect(() => {
    const bestEffort = () => {
      if (phaseRef.current !== 'playing' && phaseRef.current !== 'resting') return
      const auth = loadAuth()
      if (!auth) return
      // Flush the in-progress block's partial seconds before uploading, so an
      // early exit (page close / tab hide) doesn't lose the elapsed play time.
      // No-op during 'resting' (current block already recorded in full).
      recordPartialBlock()
      const log = sesslog.getLog()
      if (!logHasSubstance(log)) return
      void uploadSession(auth.token, log, true)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') bestEffort()
    }
    window.addEventListener('pagehide', bestEffort)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', bestEffort)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleLogout = () => {
    recordPartialBlock() // flush the in-progress block's partial seconds first
    const log = sesslog.getLog()
    // Best-effort: flush any substantive log before dropping local auth.
    // reportLog reads the token synchronously, so this races nothing.
    if (logHasSubstance(log)) void reportLog(log)
    clearAuth()
    setUser(null)
  }

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms)
    timersRef.current.push(id)
    return id
  }
  useEffect(
    () => () => {
      timersRef.current.forEach((t) => window.clearTimeout(t))
    },
    [],
  )

  /* Background gradient drift: toggle top layer every 30s (60s full cycle). */
  useEffect(() => {
    const t = window.setInterval(() => setBgAlt((v) => !v), 30000)
    return () => window.clearInterval(t)
  }, [])

  const commitCells = (next: SettledCell[]) => {
    cellsRef.current = next
    setCells(next)
  }

  const applyY = () => {
    if (yElRef.current) {
      yElRef.current.style.transform = `translateY(calc(var(--cell) * ${yRef.current.toFixed(4)}))`
    }
  }

  /** Recompute the landing row of the active piece against the current board. */
  const refreshLandRow = () => {
    const p = pieceRef.current
    if (!p) return
    const lr = landRow(buildGrid(cellsRef.current), p.shape.cells, p.x)
    landRef.current = Math.max(0, lr)
  }

  /** Topmost occupied row of the settled stack (ROWS when the board is empty). */
  const topStackRow = () => {
    const cur = cellsRef.current
    if (cur.length === 0) return ROWS
    let top = ROWS
    for (const c of cur) if (c.row < top) top = c.row
    return top
  }

  const spawnPiece = () => {
    if (phaseRef.current !== 'playing') return
    const shape = randomShape()
    const x0 = Math.max(0, Math.floor((COLS - shape.w) / 2))
    let grid = buildGrid(cellsRef.current)
    if (landRow(grid, shape.cells, x0) < 0) {
      // v2.0 兜底：面板满到新方块无法生成 → 立即清空面板，从空面板继续
      commitCells([])
      grid = emptyGrid()
    }
    const rec = recommend(grid, shape.cells, shape.w)
    const p: ActivePiece = {
      id: idRef.current++,
      shape,
      x: x0,
      ghostX: rec.x,
      ghostY: rec.y,
      xEase: 'slide',
    }
    yRef.current = 0
    glidedRef.current = false
    adoptSpeedRef.current = 0
    adoptTimeRef.current = 0
    // NOTE: idleRef (the inactivity timer) is deliberately NOT reset here —
    // "无操作" measures time since the player's last screen tap, spanning
    // pieces. Only a tap/arrow-key press resets it.
    landRef.current = Math.max(0, landRow(grid, shape.cells, x0))
    pieceRef.current = p
    setPiece(p)
  }

  /* Reset the falling-piece transform whenever a new piece mounts. */
  useEffect(() => {
    yRef.current = 0
    if (yElRef.current) yElRef.current.style.transform = 'translateY(0px)'
  }, [piece?.id])

  /* v2.0 下落音效「啾啾啾」：播放中且存在活动方块时循环播放；
     startFallingChirp 幂等，方块移动导致的 setPiece 不会重启循环。 */
  useEffect(() => {
    if (phase === 'playing' && piece) startFallingChirp()
    else stopFallingChirp()
  }, [phase, piece])
  useEffect(() => () => stopFallingChirp(), [])

  /**
   * v2.0 面板放满处理：堆叠进入顶部 6 行视为「面板放满」→ 整个面板渐隐清空，
   * 从空面板继续游戏。本轮计时不受影响（blockTimeRef 持续累计），直到满 6 分钟。
   * 返回 true 表示触发了清空（调用方不应再自行 spawnPiece，清空中会负责）。
   */
  const checkBoardFull = (): boolean => {
    if (!cellsRef.current.some((c) => c.row < 6)) return false
    commitCells(cellsRef.current.map((c) => ({ ...c, fading: true })))
    later(() => {
      commitCells([])
      refreshLandRow()
      spawnPiece()
    }, 620)
    return true
  }

  const lockPiece = () => {
    const p = pieceRef.current
    if (!p) return
    const y = Math.max(0, Math.round(landRef.current))
    const followed = p.x === p.ghostX
    if (followed) playFollowed() // v2.0「哒啦」：落到推荐位置
    else playLanding()
    sesslog.recordPiece({
      piece: p.shape.kind,
      orientation: p.shape.orient,
      ghostCol: p.ghostX,
      lockedCol: p.x,
      followed,
    })
    pieceRef.current = null
    setPiece(null)

    const settled: SettledCell[] = p.shape.cells.map(([r, c]) => ({
      id: idRef.current++,
      row: y + r,
      col: p.x + c,
      kind: p.shape.kind,
      fading: false,
    }))
    const merged = [...cellsRef.current, ...settled]
    commitCells(merged)

    const full = fullRows(buildGrid(merged))
    if (full.length > 0) {
      playLineClear() // v2.0「叮」：消行
      // Silent row clear: fade 600ms, then rows above drift down 400ms.
      commitCells(merged.map((c) => (full.includes(c.row) ? { ...c, fading: true } : c)))
      later(() => {
        const kept = cellsRef.current
          .filter((c) => !full.includes(c.row))
          .map((c) => ({ ...c, row: c.row + full.filter((fr) => fr > c.row).length }))
        commitCells(kept)
        refreshLandRow()
        if (!checkBoardFull()) spawnPiece()
      }, 620)
    } else {
      if (!checkBoardFull()) spawnPiece()
    }
  }

  /** Clear the board entirely — each block starts from a blank grid. */
  const clearBoard = () => {
    pieceRef.current = null
    setPiece(null)
    commitCells([])
  }

  /** Schedule the end of a rest period (also used when resuming into a rest). */
  const scheduleRestEnd = (blk: 1 | 2 | 3, ms: number) => {
    const t1 = window.setTimeout(() => {
      setRestLeaving(true)
      const t2 = window.setTimeout(() => {
        sesslog.recordRestEnd(blk)
        blockRef.current = (blk + 1) as 1 | 2 | 3
        resumeAudio()
        setPhase('playing')
        // New block → blank board, first piece spawns fresh.
        later(() => spawnPiece(), 800)
      }, 700)
      restTimersRef.current.push(t2)
    }, ms)
    restTimersRef.current.push(t1)
  }

  const endBlock = (blk: 1 | 2 | 3) => {
    sesslog.recordBlock(blk, blockTimeRef.current)
    blockTimeRef.current = 0
    clearBoard() // 每一轮结束后屏幕清空，下一轮从空白棋盘重新开始（仅速度不同）
    if (blk < 3) {
      sesslog.recordRestStart(blk)
      suspendAudio()
      setRestKey(blk)
      setRestLeaving(false)
      restStartRef.current = performance.now()
      setPhase('resting')
      scheduleRestEnd(blk, REST_LEN * 1000)
    } else {
      // Star 6 lit → linger 1.5s → board fades to 30% (1.5s) → end veil.
      sesslog.endSession()
      recordPartialBlock() // safety net: all blocks already recorded → no-op
      void reportLog(sesslog.getLog()) // session finished → upload
      setPhase('finished')
      setEndStage(1)
      later(() => setEndStage(2), 1500)
      later(() => setEndStage(3), 3000)
    }
  }

  /* -------------------------------------------------------------- */
  /* Main loop: only runs while phase === 'playing'                   */
  /* -------------------------------------------------------------- */
  useEffect(() => {
    if (phase !== 'playing') return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      let dt = (now - last) / 1000
      last = now
      if (dt > 0.25) dt = 0.25 // tab-switch guard
      if (dt < 0) dt = 0

      activeTimeRef.current += dt
      blockTimeRef.current += dt

      // Stars: one per 3:00 of active play.
      const lit = Math.min(6, Math.floor(activeTimeRef.current / STAR_STEP + 1e-9))
      if (lit > litRef.current) {
        litRef.current = lit
        setLitStars(lit)
      }

      // Falling piece.
      const p = pieceRef.current
      if (p) {
        idleRef.current += dt

        if (glidedRef.current) {
          // Auto-adopt animation: strictly SEQUENTIAL —
          //   phase 1 (0–GLIDE_TIME): horizontal glide, vertical position
          //     frozen, so the piece sweeps sideways at its current height
          //     and never overlaps settled blocks while moving;
          //   phase 2 (after glide): straight fast-drop at the ghost column.
          adoptTimeRef.current += dt
          if (adoptTimeRef.current > GLIDE_TIME) {
            yRef.current += adoptSpeedRef.current * dt
          }
        } else {
          yRef.current += SPEEDS[blockRef.current - 1] * dt

          // Inactivity auto-adopt: fixed threshold per block (10s / 8s / 5s).
          // "无操作" = no screen tap for that long; the timer persists across
          // pieces (piece landing/spawn does NOT reset it) — so once the
          // player has been idle past the threshold, every new piece
          // auto-adopts until the player taps again.
          //
          // Extra gate: the piece must also have fallen far enough — its
          // bottom edge must reach the row of the current HIGHEST settled
          // block (board bottom when empty) — before it glides to the ghost.
          const idleLongEnough = idleRef.current >= DESCENT_TIMES[blockRef.current - 1]
          const reachedTopRow = yRef.current + p.shape.h >= topStackRow()
          if (idleLongEnough && reachedTopRow) {
            glidedRef.current = true
            adoptTimeRef.current = 0
            const grid = buildGrid(cellsRef.current)
            const nx = p.ghostX
            landRef.current = Math.max(0, landRow(grid, p.shape.cells, nx))
            // Drop phase covers the remaining distance in GLIDE_TIME.
            adoptSpeedRef.current = Math.max(landRef.current - yRef.current, 0.5) / GLIDE_TIME
            const np: ActivePiece = { ...p, x: nx, xEase: 'glide' }
            pieceRef.current = np
            setPiece(np)
          }
        }

        if (yRef.current >= landRef.current) {
          yRef.current = landRef.current
          applyY()
          lockPiece()
        } else {
          applyY()
        }
      }

      // Block boundary (6:00 / 12:00 / 18:00 of active play).
      const blk = blockRef.current
      if (activeTimeRef.current >= blk * BLOCK_LEN) {
        endBlock(blk)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  /* -------------------------------------------------------------- */
  /* Move the active piece one column (shared by tap & keyboard)      */
  /* -------------------------------------------------------------- */
  const movePiece = (dx: -1 | 1) => {
    if (phaseRef.current !== 'playing') return
    idleRef.current = 0 // any screen tap / arrow press resets the inactivity timer
    const p = pieceRef.current
    if (!p) return
    const nx = Math.min(Math.max(p.x + dx, 0), COLS - p.shape.w)
    if (nx === p.x) return
    const grid = buildGrid(cellsRef.current)
    if (!fits(grid, p.shape.cells, nx, Math.floor(yRef.current))) return
    landRef.current = Math.max(0, landRow(grid, p.shape.cells, nx))
    const np: ActivePiece = { ...p, x: nx, xEase: 'slide' }
    pieceRef.current = np
    setPiece(np)
  }
  const movePieceRef = useRef(movePiece)
  movePieceRef.current = movePiece

  /* -------------------------------------------------------------- */
  /* Touch / click: left half of screen → left, right half → right    */
  /* -------------------------------------------------------------- */
  useEffect(() => {
    const onTap = (e: PointerEvent) => {
      if (phaseRef.current !== 'playing') return
      // Ignore taps on interactive elements (e.g. future buttons).
      if ((e.target as HTMLElement | null)?.closest('button, a')) return
      movePieceRef.current(e.clientX < window.innerWidth / 2 ? -1 : 1)
    }
    window.addEventListener('pointerdown', onTap)
    return () => window.removeEventListener('pointerdown', onTap)
  }, [])

  /* -------------------------------------------------------------- */
  /* Keyboard: ← / → kept as a desktop convenience (↓ stays disabled) */
  /* -------------------------------------------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (phaseRef.current !== 'playing') return
      if (!pieceRef.current) return
      e.preventDefault()
      movePieceRef.current(e.key === 'ArrowLeft' ? -1 : 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* -------------------------------------------------------------- */
  /* Session start (new game / restart after pause)                   */
  /* -------------------------------------------------------------- */
  const startSession = () => {
    if (phaseRef.current !== 'intro') return
    // 「重新开始」会先重置日志——旧日志若有实质内容，先上报再重置。
    // 上报前先把进行中的当前轮已玩秒数记为 partial，避免中途重开丢失时长。
    recordPartialBlock()
    const oldLog = sesslog.getLog()
    if (logHasSubstance(oldLog)) void reportLog(oldLog)
    initAudio() // unlock audio on the user's first click
    sesslog.startSession('play')
    // Full reset — a brand-new session.
    timersRef.current.forEach((t) => window.clearTimeout(t))
    timersRef.current = []
    restTimersRef.current.forEach((t) => window.clearTimeout(t))
    restTimersRef.current = []
    pieceRef.current = null
    setPiece(null)
    commitCells([])
    yRef.current = 0
    idleRef.current = 0
    activeTimeRef.current = 0
    blockTimeRef.current = 0
    blockRef.current = 1
    litRef.current = 0
    setLitStars(0)
    setEndStage(0)
    setHintOn(false)
    setHasPaused(false)
    setIntroLeaving(true)
    later(() => {
      setStarted(true)
      setPhase('playing')
      later(() => spawnPiece(), 800)
      later(() => setHintOn(true), 1500)
    }, 600)
  }

  /* -------------------------------------------------------------- */
  /* Pause → back to main screen; resume continues exactly where left */
  /* -------------------------------------------------------------- */
  const pauseGame = () => {
    if (phaseRef.current !== 'playing' && phaseRef.current !== 'resting') return
    sesslog.recordPauseStart()
    if (phaseRef.current === 'resting') {
      pausedPhaseRef.current = 'resting'
      restRemainRef.current = Math.max(
        0,
        REST_LEN * 1000 - (performance.now() - restStartRef.current),
      )
      restTimersRef.current.forEach((t) => window.clearTimeout(t))
      restTimersRef.current = []
    } else {
      pausedPhaseRef.current = 'playing'
    }
    suspendAudio()
    setHasPaused(true)
    setIntroLeaving(false)
    setPhase('intro')
  }

  const resumeGame = () => {
    if (phaseRef.current !== 'intro' || !hasPaused) return
    sesslog.recordPauseEnd()
    setHasPaused(false)
    setIntroLeaving(true)
    later(() => {
      setStarted(true)
      if (pausedPhaseRef.current === 'resting') {
        setRestLeaving(false)
        setPhase('resting') // audio stays suspended during rest
        scheduleRestEnd(blockRef.current, restRemainRef.current)
      } else {
        resumeAudio()
        setPhase('playing')
        // If the pause happened between pieces, spawn the next one.
        if (!pieceRef.current) later(() => spawnPiece(), 800)
      }
    }, 600)
  }

  /* -------------------------------------------------------------- */
  /* Render                                                           */
  /* -------------------------------------------------------------- */
  const hintText = '輕點螢幕左右兩側可以移動方塊（不點也沒關係）'

  /* Auth gate: no valid login → show the login/register screen. */
  if (!user) {
    return (
      <div className="game-root">
        <div className="bg-layer bg-a" />
        <Auth onSuccess={setUser} />
      </div>
    )
  }

  return (
    <div className="game-root">
      <div className="bg-layer bg-a" />
      <div className={bgAlt ? 'bg-layer bg-b bg-b-on' : 'bg-layer bg-b'} />

      <div className="game-column">
        <div className="star-bar" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span
              key={i}
              className={started ? 'star-in' : 'star-hidden'}
              style={started ? { animationDelay: `${i * 80}ms` } : undefined}
            >
              <Star lit={i < litStars} />
            </span>
          ))}
        </div>

        <div className="board-fade" style={{ opacity: endStage >= 2 ? 0.3 : 1 }}>
          <div className="board-panel">
            <div className="board-grid">
              <div className="bg-cells">
                {Array.from({ length: COLS * ROWS }).map((_, i) => (
                  <div key={i} className="bg-cell" />
                ))}
              </div>

              {piece &&
                piece.shape.cells.map(([r, c], i) => (
                  <div
                    key={`ghost-${piece.id}-${i}`}
                    className="ghost-cell"
                    style={{
                      left: `calc(var(--cell) * ${piece.ghostX + c})`,
                      top: `calc(var(--cell) * ${piece.ghostY + r})`,
                    }}
                  >
                    <div className="ghost-inner" />
                  </div>
                ))}

              {cells.map((c) => (
                <div
                  key={c.id}
                  className="settled-cell"
                  style={{
                    left: `calc(var(--cell) * ${c.col})`,
                    top: `calc(var(--cell) * ${c.row})`,
                    opacity: c.fading ? 0 : 1,
                  }}
                >
                  <div
                    className="cell-inner"
                    style={{
                      background: PIECE_STYLE[c.kind].fill,
                      boxShadow: `inset 0 0 0 1px ${PIECE_STYLE[c.kind].edge}`,
                    }}
                  />
                </div>
              ))}

              {piece && (
                <div
                  key={piece.id}
                  className="piece-x"
                  style={{
                    transform: `translateX(calc(var(--cell) * ${piece.x}))`,
                    transition:
                      piece.xEase === 'glide'
                        ? 'transform 700ms ease-in-out'
                        : 'transform 120ms linear',
                  }}
                >
                  <div ref={yElRef} className="piece-y">
                    {piece.shape.cells.map(([r, c], i) => (
                      <div
                        key={i}
                        className="piece-cell"
                        style={{
                          left: `calc(var(--cell) * ${c})`,
                          top: `calc(var(--cell) * ${r})`,
                        }}
                      >
                        <div
                          className="cell-inner"
                          style={{
                            background: PIECE_STYLE[piece.shape.kind].fill,
                            boxShadow: `inset 0 0 0 1px ${PIECE_STYLE[piece.shape.kind].edge}`,
                            opacity: 0.97,
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className={hintOn && phase === 'playing' ? 'hint-line hint-visible' : 'hint-line'}>
          {hintText}
        </div>
      </div>

      {phase === 'intro' && (
        <IntroVeil
          leaving={introLeaving}
          hasPaused={hasPaused}
          onStart={startSession}
          onResume={resumeGame}
        />
      )}
      {(phase === 'playing' || phase === 'resting') && (
        <button type="button" className="pause-btn" onClick={pauseGame}>
          暫停
        </button>
      )}
      <button type="button" className="logout-btn" onClick={handleLogout}>
        退出登錄
      </button>
      <button
        type="button"
        className="mute-btn"
        onClick={() => setMutedState((m) => !m)}
        aria-label={muted ? '開啟音效' : '關閉音效'}
        title={muted ? '開啟音效' : '關閉音效'}
      >
        {muted ? <VolumeX size={15} strokeWidth={2} /> : <Volume2 size={15} strokeWidth={2} />}
      </button>
      {phase === 'resting' && <RestVeil key={restKey} leaving={restLeaving} />}
      {phase === 'finished' && endStage >= 3 && <EndVeil onExport={() => sesslog.downloadLog()} />}
    </div>
  )
}
