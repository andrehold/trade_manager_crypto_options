import React from 'react'

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`w-10 h-6 rounded-full relative transition ${checked ? "bg-blue-600" : "bg-slate-300"}`}
      aria-label={label ?? 'Toggle'}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition ${checked ? "translate-x-4" : ""}`} />
    </button>
  );
}
