// Rows = spot shock, Cols = parallel IV shock. Values are PnL as % of TVL.
export const SPOT_SHOCKS = [10, 0, -10]
export const IV_SHOCKS = [-20, 0, 20]

export const STRESS_SCENARIO: number[][] = [
  [-1.9, -2.4, -3.0],
  [1.2, 0.4, -1.1],
  [-2.2, -2.7, -3.4],
]

export function worstCell(grid: number[][]): { row: number; col: number; value: number } {
  let worst = { row: 0, col: 0, value: grid[0][0] }
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] < worst.value) worst = { row: r, col: c, value: grid[r][c] }
    }
  }
  return worst
}

export function headroomPct(worstLossPct: number, limitPct: number): number {
  return limitPct - worstLossPct
}
