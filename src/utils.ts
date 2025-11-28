import React from 'react'

export type Side = 'buy' | 'sell' | string;
export type Action = 'open' | 'close' | string;
// Exchange-aware instrument parsing
export type Exchange = 'deribit' | 'coincall' | 'cme';

export interface TxnRow {
  instrument: string;
  side: Side;
  action?: Action;
  amount: number;
  price: number;
  fee?: number;
  timestamp?: string;
  trade_id?: string;
  order_id?: string;
  info?: string;
  underlying?: string;
  expiry?: string;
  strike?: number;
  optionType?: 'C' | 'P' | string;
  structureId?: string;
  linkedStructureId?: string;
  exchange?: Exchange;
}

export interface Lot { qty: number; price: number; sign: 1 | -1; }

export interface Leg {
  key: string;
  strike: number;
  optionType: 'C' | 'P' | string;
  openLots: Lot[];
  realizedPnl: number;
  netPremium: number;
  qtyNet: number;
  trades: TxnRow[];
  exchange?: Exchange;
  expiry?: string;
}

export interface Position {
  id: string;
  underlying: string;
  expiryISO: string;
  dte: number;
  legs: Leg[];
  legsCount: number;
  type: 'Single' | 'Multi-leg';
  openSinceDays?: number | null;
  strategy?: string;
  strategyCode?: string;
  realizedPnl: number;
  netPremium: number;
  pnlPct?: number | null;
  status: 'OPEN' | 'ATTENTION' | 'ALERT' | 'CLOSED';
  greeks: { delta?: number | null; gamma?: number | null; theta?: number | null; vega?: number | null; rho?: number | null; };
  playbook?: string;
  programId?: string;
  programName?: string;
  structureId?: string;
  exchange?: Exchange;
  source?: 'local' | 'supabase';
  closedAt?: string | null;
  expiries?: string[];
  archived?: boolean;
  archivedAt?: string | null;
  archivedBy?: string | null;
  clientName?: string | null;
}

export const EXPECTED_FIELDS = [
  { key: "instrument", label: "Instrument (e.g., BTC-27DEC24-50000-C)" },
  { key: "side", label: "Side (open/close + buy/sell)" },
  { key: "amount", label: "Amount / Contracts" },
  { key: "price", label: "Price" },
  { key: "fee", label: "Fee (optional)" },
  { key: "timestamp", label: "Timestamp (optional)" },
  { key: "trade_id", label: "Trade ID (optional)" },
  { key: "order_id", label: "Order ID (optional)" },
  { key: "info", label: "Info (optional)" },
] as const;

const MONTHS_MAP: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

export function parseInstrumentByExchange(exchange: Exchange, instr: string) {
  switch (exchange) {
    case 'deribit':
      return parseInstrument(instr);
    case 'coincall':
      // TODO: add Coincall parser
      return parseInstrument(instr);
    case 'cme':
      // TODO: add CME parser
      return parseInstrument(instr);
    default:
      return parseInstrument(instr);
  }
}

export function parseInstrument(instr: string) {
  const m = instr?.match(/^([A-Z]+)-(\d{1,2})([A-Z]{3})(\d{2})-(\d+)-(C|P)$/i);
  if (!m) return null;
  const [, underlying, dd, monText, yy, strike, opt] = m;
  const month = MONTHS_MAP[monText.toUpperCase()];
  const year = 2000 + Number(yy);
  const day = Number(dd);
  const expiry = new Date(Date.UTC(year, month, day));
  return {
    underlying: underlying.toUpperCase(),
    expiryISO: expiry.toISOString().slice(0, 10),
    strike: Number(strike),
    optionType: opt.toUpperCase(),
  };
}

export function daysTo(dateISO: string) {
  const today = new Date();
  const target = new Date(dateISO + "T00:00:00Z");
  const diff = target.getTime() - today.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function daysSince(dateInput: string | Date | null | undefined): number | null {
  if (!dateInput) return null;

  const normalize = (value: string | Date): Date => {
    if (value instanceof Date) return value;
    const trimmed = value.trim();
    if (!trimmed) return new Date('invalid');
    const asDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
      ? `${trimmed}T00:00:00Z`
      : trimmed.includes('T')
      ? trimmed
      : trimmed.replace(' ', 'T');
    return new Date(asDateOnly);
  };

  const target = normalize(dateInput);
  if (Number.isNaN(target.getTime())) return null;

  const now = new Date();
  const diff = now.getTime() - target.getTime();
  if (!Number.isFinite(diff)) return null;

  const dayMs = 1000 * 60 * 60 * 24;
  return Math.max(0, Math.floor(diff / dayMs));
}

export function toNumber(v: any): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = ('' + v).trim();
  if (s.indexOf(',') >= 0 && s.indexOf('.') < 0) {
    s = s.split('.').join('');
    s = s.split(',').join('.');
  } else {
    s = s.split(',').join('');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function normSide(s: string) { return (s || '').toLowerCase().trim(); }

export function parseActionSide(raw: string): { action?: 'open'|'close'; side?: 'buy'|'sell' } {
  const s = normSide(raw).replace(/\s+/g, ' ');
  if (s === 'open buy') return { action: 'open', side: 'buy' };
  if (s === 'open sell') return { action: 'open', side: 'sell' };
  if (s === 'close buy') return { action: 'close', side: 'buy' };
  if (s === 'close sell') return { action: 'close', side: 'sell' };
  if (s === 'buy') return { action: undefined, side: 'buy' };
  if (s === 'sell') return { action: undefined, side: 'sell' };
  const side = s.includes('sell') ? 'sell' : (s.includes('buy') ? 'buy' : undefined);
  const action = s.includes('open') ? 'open' : (s.includes('close') ? 'close' : undefined);
  return { action, side };
}

export function normalizeSecond(ts?: string) {
  if (!ts) return 'NO_TS';
  const s = String(ts).trim();
  const datePart = s.slice(0, 10);
  const tIdx = s.indexOf('T') >= 0 ? s.indexOf('T') : s.indexOf(' ');
  if (tIdx >= 0 && s.length >= tIdx + 9) {
    const timePart = s.slice(tIdx + 1, tIdx + 1 + 8);
    return `${datePart}T${timePart}`;
  }
  return s.length >= 19 ? s.slice(0, 19) : s;
}

export function fifoMatchAndRealize(inventory: Lot[], trade: Lot): { realized: number; remainder?: Lot } {
  let realized = 0;
  if (inventory.length === 0 || (inventory[0]?.sign === trade.sign)) {
    return { realized: 0, remainder: trade };
  }
  let remainingQty = Math.abs(trade.qty);
  while (remainingQty > 0 && inventory.length > 0) {
    const lot = inventory[0];
    if (lot.sign === trade.sign) break;
    const closeQty = Math.min(Math.abs(lot.qty), remainingQty);
    if (lot.sign === 1 && trade.sign === -1) {
      realized += (trade.price - lot.price) * closeQty;
      lot.qty -= closeQty;
    } else if (lot.sign === -1 && trade.sign === 1) {
      realized += (lot.price - trade.price) * closeQty;
      lot.qty -= closeQty;
    }
    remainingQty -= closeQty;
    if (Math.abs(lot.qty) <= 1e-9) inventory.shift();
  }
  const leftover = remainingQty > 0 ? { ...trade, qty: remainingQty } : undefined;
  return { realized, remainder: leftover };
}

export function classifyStatus(dte: number, pnlPct: number | null, realizedPnl: number) {
  if (dte <= 7 || (pnlPct !== null && pnlPct <= -10) || realizedPnl <= -100) return "ALERT" as const;
  if (dte <= 14 || (pnlPct !== null && pnlPct < 0)) return "ATTENTION" as const;
  return "OPEN" as const;
}

export function useLocalStorage<T>(key: string, initial: T) {
  const [state, setState] = React.useState<T>(() => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : initial; } catch { return initial; }
  });
  React.useEffect(() => { localStorage.setItem(key, JSON.stringify(state)); }, [key, state]);
  return [state, setState] as const;
}

export function devQuickTests() {
  try {
    const p1 = parseInstrument('BTC-27DEC25-50000-C');
    console.assert(!!p1 && p1.underlying === 'BTC' && p1.optionType === 'C' && p1.strike === 50000, 'parseInstrument failed');
    const p2 = parseInstrument('ETH-01NOV25-2200-P');
    console.assert(!!p2 && p2.underlying === 'ETH' && p2.optionType === 'P' && p2.strike === 2200, 'parseInstrument ETH put');
    const p3 = parseInstrument('BTC-PERPETUAL');
    console.assert(p3 === null, 'parseInstrument should return null for non-option');
    const px = parseInstrumentByExchange('deribit', 'BTC-27DEC25-50000-C');
    console.assert(!!px && px.underlying === 'BTC', 'parseInstrumentByExchange deribit passthrough');
    const psd = parseInstrument('BTC-7JUN24-50000-C');
    console.assert(!!psd && psd.expiryISO === '2024-06-07', 'parseInstrument handles single digit day');

    console.assert(normalizeSecond('2025-09-01 10:11:12') === '2025-09-01T10:11:12', 'normalizeSecond space');
    console.assert(normalizeSecond('2025-09-01T10:11:12.123') === '2025-09-01T10:11:12', 'normalizeSecond ms');
    console.assert(normalizeSecond(undefined) === 'NO_TS', 'normalizeSecond handles missing ts');

    const inv: Lot[] = [{ qty: 1, price: 100, sign: 1 }];
    const { realized } = fifoMatchAndRealize(inv, { qty: 1, price: 120, sign: -1 });
    console.assert(Math.abs(realized - 20) < 1e-9, 'fifoMatchAndRealize failed');

    console.assert(Math.abs(toNumber('1,234.56') - 1234.56) < 1e-9, 'toNumber US');
    console.assert(Math.abs(toNumber('1.234,56') - 1234.56) < 1e-9, 'toNumber EU');

    const s1 = parseActionSide('open buy');
    const s2 = parseActionSide('open sell');
    const s3 = parseActionSide('close buy');
    const s4 = parseActionSide('close sell');
    console.assert(s1.action==='open' && s1.side==='buy', 'parseActionSide open buy');
    console.assert(s2.action==='open' && s2.side==='sell', 'parseActionSide open sell');
    console.assert(s3.action==='close' && s3.side==='buy', 'parseActionSide close buy');
    console.assert(s4.action==='close' && s4.side==='sell', 'parseActionSide close sell');

    const endsWith0800 = (ts: string) => String(ts).trim().endsWith('08:00:00');
    console.assert(endsWith0800('2025-01-02 08:00:00'), 'endsWith 08:00:00 true');
    console.assert(!endsWith0800('2025-01-02 08:00:01'), 'endsWith 08:00:00 false');

    const sx = parseActionSide('  Open   Sell  ');
    console.assert(sx.action==='open' && sx.side==='sell', 'parseActionSide trims & lowercases');
  } catch (e) { console.warn('devQuickTests error', e); }
}

export function isoToDDMONYY(iso: string): string {
  // iso = '2025-12-27'
  const [y, m, d] = iso.split('-').map(Number)
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
  const mon = months[(m || 1) - 1]
  const dd = String(d)
  const yy = String(y).slice(-2)
  return `${dd}${mon}${yy}`
}

// Date helper for Deribit (DMMMYY, no zero-pad day):
export function isoToDMMMYY(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const mon = months[(m || 1) - 1];
  const dd = String(d); // no leading zero for Deribit
  const yy = String(y).slice(-2);
  return `${dd}${mon}${yy}`;
}

/** Build Coincall option symbol from your parsed fields */
export function toCoincallSymbol(underlying: string, expiryISO: string, strike: number, optionType: string): string {
  // BTC -> BTCUSD, ETH -> ETHUSD, else <UNDERLYING>USD
  const base = (underlying ?? '').trim().toUpperCase()
  const normalizedUnderlying = base || 'BTC'
  const index = normalizedUnderlying.endsWith('USD') ? normalizedUnderlying : `${normalizedUnderlying}USD`
  // Coincall shows various decimal places; keep raw number unless you need stricter formatting
  const strikeStr = String(strike)
  const ddmonyy = isoToDDMONYY(expiryISO)
  const t = (optionType || '').toUpperCase().startsWith('P') ? 'P' : 'C'
  return `${index}-${ddmonyy}-${strikeStr}-${t}`
}

// Build Deribit instrument name
export function toDeribitInstrument(
  underlying: string, expiryISO: string, strike: number, optionType: string
): string {
  const u = (underlying || '').toUpperCase(); // e.g., BTC / ETH
  const date = isoToDMMMYY(expiryISO);
  const k = (optionType || '').toUpperCase().startsWith('P') ? 'P' : 'C';
  const strikeStr = String(+strike); // normalize 50000.00 -> "50000"
  return `${u}-${date}-${strikeStr}-${k}`;
}

export interface LegMarkRef {
  key: string;
  symbol: string;
  exchange: Exchange;
  defaultMultiplier: number;
}

/** Build a stable cache key + symbol for fetching marks for a leg. */
export function getLegMarkRef(position: Position, leg: Leg): LegMarkRef | null {
  const exchange = (leg.exchange ?? position.exchange) as Exchange | undefined;
  if (!exchange) return null;

  const expiryISO = leg.expiry ?? position.expiryISO;
  if (!expiryISO) return null;

  if (exchange === 'coincall') {
    const symbol = toCoincallSymbol(position.underlying, expiryISO, leg.strike, leg.optionType);
    return { key: `coincall:${symbol}`, symbol, exchange, defaultMultiplier: 1 };
  }

  if (exchange === 'deribit') {
    const symbol = toDeribitInstrument(position.underlying, expiryISO, leg.strike, leg.optionType);
    return { key: `deribit:${symbol}`, symbol, exchange, defaultMultiplier: 1 };
  }

  return null;
}

/** Unrealized PnL for a single leg given mark price.
 * Uses your sign convention via openLots: lot.sign = +1 long, -1 short.
 * qty is always positive in lots; sign carries direction.
 * multiplier defaults to 1 if venue doesn't provide one.
 */
export function legUnrealizedPnL(
  leg: Leg,
  mark: number,
  multiplier?: number | null
): number {
  const m = Number.isFinite(multiplier as number) && (multiplier as number) > 0 ? (multiplier as number) : 1;
  return (leg.openLots || []).reduce((acc, lot) => {
    // profit is (mark - entry) * signed quantity
    return acc + lot.sign * lot.qty * (mark - lot.price) * m;
  }, 0);
}

/** Sum unrealized across all legs of a position, using a marks map. */
export function positionUnrealizedPnL(
  p: Position,
  marks: Record<string, { price: number | null; multiplier: number | null }>
): number {
  let sum = 0;
  for (const l of p.legs) {
    const ref = getLegMarkRef(p, l);
    if (!ref) continue;

    const info = marks[ref.key];
    if (info?.price == null) continue;

    const multiplier = ref.exchange === 'coincall' ? info.multiplier : ref.defaultMultiplier;
    sum += legUnrealizedPnL(l, info.price, multiplier);
  }
  return sum;
}

export function legNetQty(leg: Leg): number {
  // qtyNet should already be signed; this is a safe fallback from lots
  if (typeof leg.qtyNet === 'number') return leg.qtyNet;
  return (leg.openLots || []).reduce((s, lot) => s + lot.sign * lot.qty, 0);
}

/** Scale a per-contract greek by net contracts and contract multiplier. */
export function legGreekExposure(
  leg: Leg,
  perContractGreek: number | undefined,
  multiplier?: number | null
): number {
  if (!Number.isFinite(perContractGreek as number)) return 0;
  const m = Number.isFinite(multiplier as number) && (multiplier as number)! > 0 ? (multiplier as number)! : 1;
  return (perContractGreek as number) * legNetQty(leg) * m;
}

/** Sum greek across all legs in a position using the marks cache (by exchange). */
export function positionGreeks(
  p: Position,
  marks: Record<string, { price: number | null; multiplier: number | null; greeks?: any }>
): { delta: number; gamma: number; theta: number; vega: number; rho: number } {
  let delta = 0, gamma = 0, theta = 0, vega = 0, rho = 0;
  for (const l of p.legs) {
    const ref = getLegMarkRef(p, l);
    if (!ref) continue;

    const info = marks[ref.key];
    const g = info?.greeks || {};
    const multiplier = ref.exchange === 'coincall' ? info?.multiplier : ref.defaultMultiplier;

    delta += legGreekExposure(l, g.delta, multiplier);
    gamma += legGreekExposure(l, g.gamma, multiplier);
    theta += legGreekExposure(l, g.theta, multiplier);
    vega  += legGreekExposure(l, g.vega,  multiplier);
    rho   += legGreekExposure(l, g.rho,   multiplier);
  }
  return { delta, gamma, theta, vega, rho };
}

// Formatter Helper
export function fmtMoney(n: number) { const sign = n < 0 ? '-' : ''; return `${sign}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`; }
export function fmtNumber(n: number) { return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`; }

export function fmtGreek(n: number | null | undefined, digits = 4): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return (n as number).toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function fmtPremium(n: number, asset?: string) {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const sym = (asset || '').toUpperCase();
  if (sym === 'BTC' || sym === 'ETH') {
    return `${sign}${abs.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${sym}`;
  }
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
