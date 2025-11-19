import { Position, legNetQty } from "../../utils";

const MONTH_ABBREVIATIONS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function formatExpiryToken(expiryISO?: string | null): string | null {
  if (!expiryISO) return null;
  const trimmed = expiryISO.trim();
  if (!trimmed || trimmed === '—') return null;
  const normalized = trimmed.length === 10 ? `${trimmed}T00:00:00Z` : trimmed;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return trimmed.toUpperCase();
  }
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = MONTH_ABBREVIATIONS[date.getUTCMonth()];
  const year = String(date.getUTCFullYear()).slice(-2);
  if (!month) return trimmed.toUpperCase();
  return `${day}${month}${year}`;
}

function formatCompactStrike(strike?: number | null): string | null {
  if (!Number.isFinite(strike as number)) return null;
  const base = (strike as number) / 1000;
  if (!Number.isFinite(base)) return null;
  if (Number.isInteger(base)) return base.toFixed(0);
  return base
    .toFixed(3)
    .replace(/\.0+$/, '')
    .replace(/0+$/, '')
    .replace(/\.$/, '');
}

function buildLegSummary(legs: Position['legs']): string {
  if (!Array.isArray(legs) || legs.length === 0) return '';
  const tokens = legs
    .map((leg) => {
      if (!leg) return null;
      const signedQty = legNetQty(leg);
      if (!Number.isFinite(signedQty) || signedQty === 0) return null;
      const sign = signedQty > 0 ? '+' : '-';
      const opt = (leg.optionType ?? '').toUpperCase().startsWith('P') ? 'P' : 'C';
      const strikeText = formatCompactStrike(leg.strike);
      if (!strikeText) return null;
      return `${sign}${opt}${strikeText}`;
    })
    .filter((token): token is string => Boolean(token));
  return tokens.join('/');
}

function deriveLegSizeToken(legs: Position['legs']): string | null {
  for (const leg of legs) {
    const qty = Math.abs(legNetQty(leg));
    if (!Number.isFinite(qty) || qty === 0) continue;
    if (Number.isInteger(qty)) return `x${qty}`;
    return `x${qty.toFixed(2).replace(/\.0+$/, '').replace(/0+$/, '').replace(/\.$/, '')}`;
  }
  return null;
}

export function buildStructureChipSummary(position: Position): string | null {
  const underlyingText = (position.underlying ?? '').toUpperCase().trim();
  const expiryToken = formatExpiryToken(position.expiryISO) ?? position.expiryISO?.trim() ?? '';
  const structureCodeText = (position.strategyCode ?? '').toUpperCase().trim();
  const legSizeToken = deriveLegSizeToken(position.legs);
  const legsSummary = buildLegSummary(position.legs);

  const leadingParts = [underlyingText || null, expiryToken || null, structureCodeText || null]
    .filter((part): part is string => Boolean(part))
    .join(' ');

  const withSize = legSizeToken ? `${leadingParts} ${legSizeToken}`.trim() : leadingParts;
  const summaryLine = withSize ? (legsSummary ? `${withSize} : ${legsSummary}` : withSize) : legsSummary;
  const fallbackSummary = (summaryLine || legsSummary || underlyingText || '').trim();
  const normalized = fallbackSummary.replace(/\s+/g, ' ').trim();
  return normalized.length ? normalized : null;
}
