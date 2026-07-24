import { STRESS_SCENARIO, SPOT_SHOCKS, IV_SHOCKS, worstCell } from './stress'

const fmt = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1))
const sign = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`)

export function StressMatrix({ grid = STRESS_SCENARIO }: { grid?: number[][] }) {
  const worst = worstCell(grid)
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="border-collapse font-mono text-xs">
        <caption className="pb-2 text-left font-sans text-[11px] text-text-tertiary">
          Worst loss across ±10% spot × ±20% parallel IV shift (PnL as % of TVL)
        </caption>
        <thead>
          <tr>
            <th className="px-3.5 py-1.5 text-left text-[10px] text-text-tertiary">spot ╲ IV</th>
            {IV_SHOCKS.map((iv) => (
              <th key={iv} className="px-3.5 py-1.5 text-[10.5px] font-semibold text-text-tertiary whitespace-nowrap">IV {sign(iv)}%</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, r) => (
            <tr key={SPOT_SHOCKS[r]}>
              <th className="px-3.5 py-2 text-left text-[10.5px] font-semibold text-text-tertiary whitespace-nowrap">spot {sign(SPOT_SHOCKS[r])}%</th>
              {row.map((v, c) => {
                const isWorst = r === worst.row && c === worst.col
                return (
                  <td
                    key={c}
                    data-role={isWorst ? 'worst' : undefined}
                    className={`border border-border-default px-3.5 py-2 text-center tabular-nums ${
                      isWorst ? 'bg-status-danger/15 font-bold text-status-danger shadow-[inset_0_0_0_1px_var(--color-status-danger)]'
                      : v > 0 ? 'text-status-success' : 'text-text-secondary'
                    }`}
                  >
                    {fmt(v)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
