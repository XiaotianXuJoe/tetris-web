/** Board logic: grid helpers + ghost-column recommendation heuristic. */

import type { CellOffset } from './pieces'
import type { PieceKind } from './pieces'

export const COLS = 10
export const ROWS = 20

export type Grid = (PieceKind | null)[][]

export function emptyGrid(): Grid {
  return Array.from({ length: ROWS }, () => Array<PieceKind | null>(COLS).fill(null))
}

/** True if all piece cells fit inside the board at (x, y) without overlap. */
export function fits(grid: Grid, cells: readonly CellOffset[], x: number, y: number): boolean {
  for (const [r, c] of cells) {
    const rr = y + r
    const cc = x + c
    if (cc < 0 || cc >= COLS || rr >= ROWS) return false
    if (rr >= 0 && grid[rr][cc]) return false
  }
  return true
}

/** Lowest row offset at which the piece still fits in column x (-1 if it never fits). */
export function landRow(grid: Grid, cells: readonly CellOffset[], x: number): number {
  if (!fits(grid, cells, x, 0)) return -1
  let y = 0
  while (fits(grid, cells, x, y + 1)) y++
  return y
}

/**
 * Ghost hint heuristic: try every legal column, simulate the lock, and pick the
 * placement that (1) minimizes the resulting max stack height, then
 * (2) minimizes aggregate column height, then (3) stays nearest the center.
 */
export function recommend(
  grid: Grid,
  cells: readonly CellOffset[],
  w: number,
): { x: number; y: number } {
  let bestX = -1
  let bestY = 0
  let bestScore: [number, number, number] | null = null
  for (let x = 0; x <= COLS - w; x++) {
    const y = landRow(grid, cells, x)
    if (y < 0) continue
    const sim = grid.map((row) => row.slice())
    for (const [r, c] of cells) sim[y + r][x + c] = 'O'
    let maxH = 0
    let aggH = 0
    for (let col = 0; col < COLS; col++) {
      let h = 0
      for (let row = 0; row < ROWS; row++) {
        if (sim[row][col]) {
          h = ROWS - row
          break
        }
      }
      maxH = Math.max(maxH, h)
      aggH += h
    }
    const centerDist = Math.abs(x + w / 2 - COLS / 2)
    const score: [number, number, number] = [maxH, aggH, centerDist]
    if (
      !bestScore ||
      score[0] < bestScore[0] ||
      (score[0] === bestScore[0] &&
        (score[1] < bestScore[1] || (score[1] === bestScore[1] && score[2] < bestScore[2])))
    ) {
      bestScore = score
      bestX = x
      bestY = y
    }
  }
  if (bestX < 0) {
    bestX = Math.max(0, Math.floor((COLS - w) / 2))
    bestY = 0
  }
  return { x: bestX, y: bestY }
}

/** Indices of fully occupied rows. */
export function fullRows(grid: Grid): number[] {
  const out: number[] = []
  for (let r = 0; r < ROWS; r++) {
    if (grid[r].every((c) => c !== null)) out.push(r)
  }
  return out
}
