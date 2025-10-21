import React from 'react'

export function NumberCell({ value, onChange }: { value: number | null | undefined; onChange: (v: number | null) => void; }) {
  const [s, setS] = React.useState(value == null ? '' : String(value));
  React.useEffect(() => { setS(value == null ? '' : String(value)); }, [value]);
  return (
    <input
      value={s}
      onChange={(e) => {
        const v = e.target.value; setS(v);
        const num = v.trim() === '' ? null : Number(v);
        if (v.trim() === '' || Number.isFinite(num)) onChange(v.trim() === '' ? null : num);
      }}
      placeholder="—"
      className="border rounded-lg px-2 py-1 text-sm w-20"
    />
  );
}
