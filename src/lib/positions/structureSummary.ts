import { Position, legNetQty } from "../../utils";

const MONTH_ABBREVIATIONS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function parseExpiryTime(expiryISO?: string | null): number | null {
  if (!expiryISO) return null;
  const trimmed = expiryISO.trim();
  if (!trimmed || trimmed === '—') return null;
  const normalized = trimmed.length === 10 ? `${trimmed}T00:00:00Z` : trimmed;
  const date = new Date(normalized);
  const time = date.getTime();
  if (Number.isNaN(time)) return null;
  return time;
}

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

function buildLegSummary(legs: Position['legs'], fallbackExpiry?: string | null): string {
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
      const expirySource = leg.expiry ?? fallbackExpiry;
      const expiryTime = parseExpiryTime(expirySource) ?? Number.POSITIVE_INFINITY;
      const strikeValue = Number.isFinite(leg.strike as number) ? (leg.strike as number) : Number.POSITIVE_INFINITY;
      const optionOrder = opt === 'P' ? 0 : 1;
      return {
        expiryTime,
        strikeValue,
        optionOrder,
        token: `${sign}${opt}${strikeText}`,
      };
    })
    .filter((token): token is { expiryTime: number; strikeValue: number; optionOrder: number; token: string } =>
      Boolean(token),
    )
    .sort((a, b) => {
      if (a.expiryTime !== b.expiryTime) return a.expiryTime - b.expiryTime;
      if (a.strikeValue !== b.strikeValue) return a.strikeValue - b.strikeValue;
      if (a.optionOrder !== b.optionOrder) return a.optionOrder - b.optionOrder;
      return a.token.localeCompare(b.token);
    });
  return tokens.map((token) => token.token).join(' / ');
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

function collectExpiryTokens(position: Position): string[] {
  const expiryCandidates = position.legs
    .map((leg) => leg.expiry)
    .filter((expiry): expiry is string => Boolean(expiry && expiry.trim().length));
  if (expiryCandidates.length === 0 && position.expiryISO) {
    expiryCandidates.push(position.expiryISO);
  }
  const unique = new Map<string, { token: string; time: number | null }>();
  for (const expiry of expiryCandidates) {
    const token = formatExpiryToken(expiry);
    if (!token) continue;
    const time = parseExpiryTime(expiry);
    if (!unique.has(token)) {
      unique.set(token, { token, time });
    } else {
      const existing = unique.get(token);
      if (existing && existing.time === null && time !== null) {
        unique.set(token, { token, time });
      }
    }
  }
  return Array.from(unique.values())
    .sort((a, b) => {
      const timeA = a.time ?? Number.POSITIVE_INFINITY;
      const timeB = b.time ?? Number.POSITIVE_INFINITY;
      if (timeA !== timeB) return timeA - timeB;
      return a.token.localeCompare(b.token, undefined, { sensitivity: 'base' });
    })
    .map((entry) => entry.token);
}

export function buildStructureSummaryLines(
  position: Position,
): { header: string; legs: string | null } | null {
  const underlyingText = (position.underlying ?? '').toUpperCase().trim();
  const expiryTokens = collectExpiryTokens(position);
  const expiryText = expiryTokens.join(' / ');
  const structureCodeText = (position.strategyCode ?? '').toUpperCase().trim();
  const legSizeToken = deriveLegSizeToken(position.legs);
  const legsSummary = buildLegSummary(position.legs, position.expiryISO);

  const hasMultipleExpiries = expiryTokens.length > 1;
  const baseHeaderParts = [underlyingText || null, expiryText || null].filter((part): part is string => Boolean(part));
  let header = baseHeaderParts.join(' ');
  if (hasMultipleExpiries && structureCodeText) {
    header = header ? `${header} -- ${structureCodeText} --` : `-- ${structureCodeText} --`;
  } else {
    const compactParts = [header || null, structureCodeText || null].filter((part): part is string => Boolean(part));
    header = compactParts.join(' ');
  }
  if (legSizeToken) {
    header = header ? `${header} ${legSizeToken}` : legSizeToken;
  }

  const normalizedHeader = header.replace(/\s+/g, ' ').trim();
  const normalizedLegs = legsSummary.replace(/\s+/g, ' ').trim();
  if (!normalizedHeader && !normalizedLegs) return null;
  if (!normalizedHeader && normalizedLegs) {
    return { header: normalizedLegs, legs: null };
  }
  return {
    header: normalizedHeader,
    legs: normalizedLegs.length ? normalizedLegs : null,
  };
}

export function buildStructureChipSummary(position: Position): string | null {
  const underlyingText = (position.underlying ?? '').toUpperCase().trim();
  const expiryToken = formatExpiryToken(position.expiryISO) ?? position.expiryISO?.trim() ?? '';
  const structureCodeText = (position.strategyCode ?? '').toUpperCase().trim();
  const legSizeToken = deriveLegSizeToken(position.legs);
  const legsSummary = buildLegSummary(position.legs, position.expiryISO);

  const leadingParts = [underlyingText || null, expiryToken || null, structureCodeText || null]
    .filter((part): part is string => Boolean(part))
    .join(' ');

  const withSize = legSizeToken ? `${leadingParts} ${legSizeToken}`.trim() : leadingParts;
  const summaryLine = withSize ? (legsSummary ? `${withSize} : ${legsSummary}` : withSize) : legsSummary;
  const fallbackSummary = (summaryLine || legsSummary || underlyingText || '').trim();
  const normalized = fallbackSummary.replace(/\s+/g, ' ').trim();
  return normalized.length ? normalized : null;
}
