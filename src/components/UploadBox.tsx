import React from 'react'

export function UploadBox({ onFiles }: { onFiles: (files: FileList) => void }) {
  const ref = React.useRef<HTMLInputElement | null>(null);
  return (
    <div className="border-2 border-dashed border-slate-300 rounded-2xl p-6 text-center">
      <p className="text-sm text-slate-600">Drop your Deribit CSV here, or</p>
      <button
        onClick={() => ref.current?.click()}
        className="mt-3 rounded-xl bg-slate-900 text-white px-4 py-2 text-sm shadow"
      >Choose file</button>
      <input ref={ref} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files && onFiles(e.target.files)} />
    </div>
  );
}
