/**
 * Procedural Web Audio: one gentle piano-like tone per piece landing.
 * Triangle + sine partial, ~0.9s decay, low-passed, gain ceiling 0.12.
 * Pitch wanders a pentatonic set with a neighbor-biased random walk.
 * Silent during rests (context suspended); tones coalesce within 250ms.
 */

const FREQS = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5] // C5 D5 E5 G5 A5 C6
const MIN_INTERVAL_MS = 250

let ctx: AudioContext | null = null
let master: GainNode | null = null
let lastIdx = 2
let lastPlayAt = 0
let muted = false

/** v2.1 静音开关：静音时立即停止下落循环音，后续所有播放直接跳过 */
export function setMuted(m: boolean): void {
  muted = m
  if (m) stopFallingChirp()
}

export function isMuted(): boolean {
  return muted
}

/** Must be called from a user gesture (the intro card button). */
export function initAudio(): void {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
    return
  }
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return
  ctx = new AC()
  master = ctx.createGain()
  master.gain.value = 1
  master.connect(ctx.destination)
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
}

export function suspendAudio(): void {
  if (ctx && ctx.state === 'running') void ctx.suspend().catch(() => undefined)
}

export function resumeAudio(): void {
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
}

export function playLanding(): void {
  if (muted || !ctx || !master || ctx.state !== 'running') return
  const nowMs = performance.now()
  if (nowMs - lastPlayAt < MIN_INTERVAL_MS) return
  lastPlayAt = nowMs

  // Neighbor-biased random walk across the pentatonic set.
  const steps = [-1, -1, 0, 1, 1, -2, 2]
  let idx = lastIdx + steps[Math.floor(Math.random() * steps.length)]
  idx = Math.max(0, Math.min(FREQS.length - 1, idx))
  lastIdx = idx
  const f = FREQS[idx]

  const t = ctx.currentTime
  const tri = ctx.createOscillator()
  tri.type = 'triangle'
  tri.frequency.value = f
  const sine = ctx.createOscillator()
  sine.type = 'sine'
  sine.frequency.value = f * 2

  const sineGain = ctx.createGain()
  sineGain.gain.value = 0.35

  const env = ctx.createGain()
  env.gain.setValueAtTime(0, t)
  env.gain.linearRampToValueAtTime(0.12, t + 0.008)
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.9)

  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 2200
  filter.Q.value = 0.4

  tri.connect(env)
  sine.connect(sineGain)
  sineGain.connect(env)
  env.connect(filter)
  filter.connect(master)

  tri.start(t)
  sine.start(t)
  tri.stop(t + 1.0)
  sine.stop(t + 1.0)
  tri.onended = () => {
    tri.disconnect()
    sine.disconnect()
    sineGain.disconnect()
    env.disconnect()
    filter.disconnect()
  }
}

/* ------------------------------------------------------------------ */
/* v2.0 音效：下落「啾啾啾」/ 落到推荐位「哒啦」/ 消行「叮」           */
/* ------------------------------------------------------------------ */

/** 通用短音：单振荡器 + 指数衰减包络 */
function tone(
  freq: number,
  t0: number,
  dur: number,
  peak: number,
  type: OscillatorType = 'sine',
  glideTo?: number,
): void {
  if (muted || !ctx || !master) return
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur * 0.8)
  const env = ctx.createGain()
  env.gain.setValueAtTime(0, t0)
  env.gain.linearRampToValueAtTime(peak, t0 + 0.012)
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(env)
  env.connect(master)
  osc.start(t0)
  osc.stop(t0 + dur + 0.05)
  osc.onended = () => {
    osc.disconnect()
    env.disconnect()
  }
}

/** 单声「啾」：正弦上滑 1750→2650Hz，0.13s，轻快短促 */
function chirpOnce(t0: number): void {
  tone(1750, t0, 0.13, 0.05, 'sine', 2650)
}

/** 「啾啾啾」三连音 */
function chirpTriple(): void {
  if (!ctx || ctx.state !== 'running') return
  const t = ctx.currentTime
  chirpOnce(t)
  chirpOnce(t + 0.17)
  chirpOnce(t + 0.34)
}

let fallTimer: number | null = null

/** 方块下落期间循环「啾啾啾」（每 1.6s 一轮）；重复调用安全（幂等） */
export function startFallingChirp(): void {
  if (muted || !ctx || ctx.state !== 'running') return
  if (fallTimer !== null) return
  chirpTriple()
  fallTimer = window.setInterval(chirpTriple, 1600)
}

export function stopFallingChirp(): void {
  if (fallTimer !== null) {
    window.clearInterval(fallTimer)
    fallTimer = null
  }
}

/** 「哒啦」：方块落到推荐位置 —— 两个轻快上行音（E5 → A5） */
export function playFollowed(): void {
  if (!ctx || ctx.state !== 'running') return
  const t = ctx.currentTime
  tone(659.25, t, 0.14, 0.12, 'triangle') // 哒
  tone(880.0, t + 0.12, 0.32, 0.12, 'triangle') // 啦
}

/** 「叮」：消行 —— 清脆铃音 C7 + 二倍泛音，1.1s 衰减 */
export function playLineClear(): void {
  if (!ctx || ctx.state !== 'running') return
  const t = ctx.currentTime
  tone(2093.0, t, 1.1, 0.11, 'sine')
  tone(4186.0, t, 0.5, 0.03, 'sine')
}
