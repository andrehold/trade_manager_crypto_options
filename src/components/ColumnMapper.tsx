import React from 'react'
import { EXPECTED_FIELDS } from '../utils'

export function ColumnMapper({ headers, onConfirm, onCancel, mode = 'import' }: {
  headers: string[];
  onConfirm: (map: Record<string, string>) => void;
  onCancel: () => void;
  mode?: 'import' | 'backfill';
}) {
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [exchange, setExchange] = React.useState<'deribit' | 'coincall' | 'cme'>('deribit');

  React.useEffect(() => {
    const lower = headers.map((h) => h.toLowerCase());
    const exact = (name: string) => {
      const idx = lower.indexOf(name.toLowerCase());
      return idx >= 0 ? headers[idx] : '';
    };
    const guess = (needle: string[]) => {
      const i = lower.findIndex((h) => needle.some((n) => h.includes(n)));
      return i >= 0 ? headers[i] : '';
    };
    const initial: Record<string, string> = {
      instrument: exact('instrument') || guess(['instrument', 'instrument_name', 'instrument name', 'symbol']),
      side: exact('side') || guess(['side', 'direction', 'buy', 'sell', 'trade side', 'order side', 'type']),
      amount: exact('amount') || guess(['amount', 'contracts', 'qty', 'quantity', 'size', 'contract size']),
      price: exact('price') || guess(['price', 'fill price', 'avg price', 'average price']),
      fee: exact('fee') || guess(['fee', 'commission', 'cost']),
      timestamp: exact('date') || exact('timestamp') || guess(['time', 'timestamp', 'date', 'datetime', 'trade time', 'execution time']),
      trade_id: exact('trade id') || exact('trade_id') || guess(['trade id', 'trade_id', 'tradeid', 'id', 'exec id', 'execution id']),
      order_id: exact('order id') || exact('order_id') || guess(['order id', 'order_id', 'orderid']),
      info: exact('info') || guess(['info', 'note', 'comment']),
    };
    setMapping(initial);
  }, [headers]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6">
        <h3 className="text-lg font-semibold">Map CSV Columns</h3>
        <p className="text-sm text-slate-600 mb-4">
          {mode === 'backfill'
            ? 'Select the instrument column plus trade_id or order_id to backfill legs. Other fields are optional.'
            : 'Tell the importer which CSV columns correspond to the required fields.'}
        </p>
        {/* NEW: Exchange selector */}
        <div className="mb-4">
          <label className="text-sm block text-slate-600 mb-1">Exchange</label>
          <select
            value={exchange}
            onChange={(e) => setExchange(e.target.value as 'deribit' | 'coincall' | 'cme')}
            className="w-full border rounded-xl p-2 focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            <option value="deribit">Deribit</option>
            <option value="coincall">Coincall</option>
            <option value="cme">CME</option>
          </select>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {EXPECTED_FIELDS.map((f) => (
            <label key={f.key} className="text-sm">
              <span className="block text-slate-600 mb-1">{f.label}</span>
              <select
                value={mapping[f.key] || ""}
                onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                className="w-full border rounded-xl p-2 focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="">— Select column —</option>
                {headers.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <div className="mt-6 flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl border">Cancel</button>
          <button
            onClick={() => onConfirm({ ...mapping, __exchange: exchange } as any)}
            className="px-4 py-2 rounded-xl bg-slate-900 text-white">
            {mode === 'backfill' ? 'Start Backfill' : 'Start Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
