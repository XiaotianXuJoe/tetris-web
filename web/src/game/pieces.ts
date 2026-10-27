/** Piece definitions: 7 tetrominoes, fixed calm Morandi colors, no rotation. */

export type PieceKind = 'O' | 'I' | 'L' | 'J' | 'T' | 'S' | 'Z'
export type Orientation = 'h' | 'v'

export const PIECE_STYLE: Record<PieceKind, { fill: string; edge: string }> = {
  O: { fill: '#E3D1A2', edge: '#D4BF8B' },
  I: { fill: '#A9BECB', edge: '#97AEBD' },
  L: { fill: '#D8B49A', edge: '#C8A387' },
  J: { fill: '#B5AFC4', edge: '#A49EB4' },
  T: { fill: '#AEBFA8', edge: '#9DAE96' },
  S: { fill: '#D3AFAF', edge: '#C29E9E' },
  Z: { fill: '#C4B39E', edge: '#B3A28C' },
}

/** Base (horizontal) matrices. */
const BASE: Record<PieceKind, number[][]> = {
  O: [
    [1, 1],
    [1, 1],
  ],
  I: [[1, 1, 1, 1]],
  L: [
    [1, 0, 0],
    [1, 1, 1],
  ],
  J: [
    [0, 0, 1],
    [1, 1, 1],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
  ],
}

function rotateCW(m: number[][]): number[][] {
  const rows = m.length
  const cols = m[0].length
  const out: number[][] = []
  for (let c = 0; c < cols; c++) {
    const row: number[] = []
    for (let r = rows - 1; r >= 0; r--) row.push(m[r][c])
    out.push(row)
  }
  return out
}

export type CellOffset = readonly [number, number]

export interface PieceShape {
  kind: PieceKind
  orient: Orientation
  cells: CellOffset[]
  w: number
  h: number
}

export function getShape(kind: PieceKind, orient: Orientation): PieceShape {
  const m = orient === 'v' ? rotateCW(BASE[kind]) : BASE[kind]
  const cells: [number, number][] = []
  for (let r = 0; r < m.length; r++) {
    for (let c = 0; c < m[r].length; c++) {
      if (m[r][c]) cells.push([r, c])
    }
  }
  return { kind, orient, cells, w: m[0].length, h: m.length }
}

const KINDS: PieceKind[] = ['O', 'I', 'L', 'J', 'T', 'S', 'Z']

/** Random piece; orientation pre-selected at spawn (O has a single orientation). */
export function randomShape(): PieceShape {
  const kind = KINDS[Math.floor(Math.random() * KINDS.length)]
  const orient: Orientation = kind === 'O' ? 'h' : Math.random() < 0.5 ? 'h' : 'v'
  return getShape(kind, orient)
}
