import React from 'react'

export type ColumnPickerProps = {
  visibleCols: string[]
  onVisibleColsChange: (updater: (prev: string[]) => string[]) => void
}

const ALL_COLUMNS = [
  { key: "status", label: "Status" },
  { key: "dte", label: "DTE/Since" },
  { key: "strategy", label: "Strategy" },
  { key: "pnl", label: "PnL $" },
  { key: "pnlpct", label: "PnL %" },
  { key: "delta", label: "Δ" },
  { key: "gamma", label: "Γ" },
  { key: "theta", label: "Θ" },
  { key: "vega", label: "V" },
  { key: "rho", label: "ρ" },
  { key: "playbook", label: "Playbook" },
];

export function ColumnPicker({ visibleCols, onVisibleColsChange }: ColumnPickerProps) {
  return (
    <details className="ml-auto">
      <summary className="type-subhead text-subtle cursor-pointer select-none">Columns</summary>
      <div className="absolute mt-2 bg-surface-section border border-border-strong rounded-xl shadow-xl p-3 z-dropdown">
        {ALL_COLUMNS.map((c) => (
          <label key={c.key} className="flex items-center gap-2 type-subhead text-subtle py-1">
            <input
              type="checkbox"
              checked={visibleCols.includes(c.key)}
              onChange={(e) => {
                const checked = e.target.checked;
                onVisibleColsChange((prev) => checked ? [...prev, c.key] : prev.filter((k) => k !== c.key));
              }}
            />
            {c.label}
          </label>
        ))}
      </div>
    </details>
  );
}
