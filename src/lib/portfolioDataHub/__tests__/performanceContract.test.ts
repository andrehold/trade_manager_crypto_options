import { describe, expect, it } from 'vitest';
import baselineFixture from '../__fixtures__/performance/provisional.json';
import readyFixture from '../__fixtures__/performance/lifetime-ready.json';
import provisionalFixture from '../__fixtures__/performance/lifetime-provisional.json';
import unavailableFixture from '../__fixtures__/performance/lifetime-unavailable.json';
import {
  isLifetimePerformanceFinal,
  lifetimePerformanceDatapointSchema,
  lifetimePerformanceDisplayStatus,
  parseHubLifetimePerformance,
} from '..';

function cloneRecord(value: unknown): Record<string, unknown> {
  return structuredClone(value) as Record<string, unknown>;
}

function childRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  return parent[key] as Record<string, unknown>;
}

describe('Portfolio Data Hub lifetime performance contract', () => {
  it.each([
    ['ready', readyFixture, 'ready'],
    ['provisional', provisionalFixture, 'provisional'],
    ['unavailable', unavailableFixture, 'unavailable'],
  ] as const)('parses the sanitized %s fixture', (_name, fixture, performanceStatus) => {
    const result = parseHubLifetimePerformance(fixture);

    expect(result.quality.performanceStatus).toBe(performanceStatus);
    expect(result.accountId).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('normalizes all seven exact performance totals without converting null to zero', () => {
    const provisional = parseHubLifetimePerformance(provisionalFixture);
    const unavailable = parseHubLifetimePerformance(unavailableFixture);

    expect(provisional.performance).toEqual({
      openingEquity: '1000.00',
      contributions: '0.00',
      distributions: '0.00',
      transfersIn: '0.00',
      transfersOut: '200.00',
      netCapitalFlow: '-200.00',
      pnl: '25.00',
    });
    expect(unavailable.openingEquity).toBeNull();
    expect(unavailable.performance).toBeNull();
  });

  it('keeps equity and performance statuses independent', () => {
    const result = parseHubLifetimePerformance(provisionalFixture);

    expect(result.quality).toMatchObject({
      equityStatus: 'ready',
      performanceStatus: 'provisional',
      freshness: 'fresh',
      recalculationPending: false,
      reasonCodes: ['movement_unresolved', 'snapshot_time_approximate'],
    });
    expect(result.timeBasis).toBe('collection_time_approximation');
  });

  it('marks performance final only when the complete readiness predicate holds', () => {
    const ready = parseHubLifetimePerformance(readyFixture);
    expect(isLifetimePerformanceFinal(ready.quality)).toBe(true);
    expect(lifetimePerformanceDisplayStatus(ready.quality)).toBe('ready');

    const nonFinalQualities = [
      { ...ready.quality, equityStatus: 'provisional' as const },
      { ...ready.quality, recalculationPending: true },
      { ...ready.quality, unresolvedMovementCount: 1 },
      { ...ready.quality, reasonCodes: ['recalculation_pending'] },
    ];
    for (const quality of nonFinalQualities) {
      expect(isLifetimePerformanceFinal(quality)).toBe(false);
      expect(lifetimePerformanceDisplayStatus(quality)).toBe('provisional');
    }

    const unavailable = parseHubLifetimePerformance(unavailableFixture);
    expect(lifetimePerformanceDisplayStatus(unavailable.quality)).toBe('unavailable');
  });

  it('normalizes complete quality and lineage without exposing opaque details', () => {
    const result = parseHubLifetimePerformance(provisionalFixture);

    expect(result.quality).toEqual({
      equityStatus: 'ready',
      performanceStatus: 'provisional',
      freshness: 'fresh',
      recalculationPending: false,
      unresolvedMovementCount: 1,
      ledgerCoverageFrom: '2026-01-01T00:00:00Z',
      ledgerCoverageThrough: '2026-10-15T12:00:00Z',
      reasonCodes: ['movement_unresolved', 'snapshot_time_approximate'],
    });
    expect(result.lineage).toEqual({
      summarySnapshotId: '20000000-0000-4000-8000-000000000003',
      lifetimeAnchorId: '20000000-0000-4000-8000-000000000004',
      startEventId: '20000000-0000-4000-8000-000000000005',
      startAt: '2026-01-01T00:00:00Z',
      openingBasis: 'observed_snapshot',
      canonicalInputSequence: 2401,
      classificationSequence: 145,
      calculationVersion: 'performance-v1',
    });
    expect(result.quality).not.toHaveProperty('details');
  });

  it('accepts integer and null revisions while rejecting missing, string, and fractional values', () => {
    const nullable = cloneRecord(provisionalFixture);
    nullable.revision = null;
    expect(parseHubLifetimePerformance(nullable)).toMatchObject({
      revision: null,
    });

    const omitted = cloneRecord(provisionalFixture);
    delete omitted.revision;
    expect(() => parseHubLifetimePerformance(omitted)).toThrow();

    for (const invalid of ['7', 7.5]) {
      const invalidRevision = cloneRecord(provisionalFixture);
      invalidRevision.revision = invalid;
      expect(() => parseHubLifetimePerformance(invalidRevision)).toThrow();
    }
  });

  it('preserves exact decimal strings including zero and negative zero', () => {
    const input = cloneRecord(provisionalFixture);
    input.equity = '-0';
    input.opening_equity = '0.00';
    const totals = childRecord(input, 'performance');
    totals.opening_equity = '0';
    totals.contributions = null;
    totals.net_capital_flow = null;
    totals.pnl = '0e-8';

    const result = parseHubLifetimePerformance(input);
    expect(result.equity).toBe('-0');
    expect(result.openingEquity).toBe('0.00');
    expect(result.performance?.openingEquity).toBe('0');
    expect(result.performance?.contributions).toBeNull();
    expect(result.performance?.pnl).toBe('0e-8');

    const malformed = cloneRecord(input);
    childRecord(malformed, 'performance').pnl = 'not-a-decimal';
    expect(() => parseHubLifetimePerformance(malformed)).toThrow(/exact decimal string/i);
  });

  it('rejects unknown status and freshness values', () => {
    for (const [field, value] of [
      ['equity_status', 'pending'],
      ['performance_status', 'complete'],
      ['freshness', 'old'],
    ] as const) {
      const input = cloneRecord(provisionalFixture);
      childRecord(input, 'quality')[field] = value;
      expect(() => parseHubLifetimePerformance(input)).toThrow();
    }
  });

  it('accepts stale freshness as distinct from performance completeness', () => {
    const input = cloneRecord(provisionalFixture);
    childRecord(input, 'quality').freshness = 'stale';

    const result = parseHubLifetimePerformance(input);
    expect(result.quality.freshness).toBe('stale');
    expect(result.quality.performanceStatus).toBe('provisional');
  });

  it('accepts unknown non-empty reason codes and rejects empty ones', () => {
    const futureReason = cloneRecord(provisionalFixture);
    childRecord(futureReason, 'quality').reason_codes = ['future_hub_reason'];
    expect(parseHubLifetimePerformance(futureReason).quality.reasonCodes).toEqual(['future_hub_reason']);

    for (const reason of ['', '   ']) {
      const invalid = cloneRecord(provisionalFixture);
      childRecord(invalid, 'quality').reason_codes = [reason];
      expect(() => parseHubLifetimePerformance(invalid)).toThrow(/reason code/i);
    }
  });

  it('requires schema version 1.0 and does not invent omitted contract fields', () => {
    const missingVersion = cloneRecord(unavailableFixture);
    delete missingVersion.performance_schema_version;
    expect(() => parseHubLifetimePerformance(missingVersion)).toThrow();

    const wrongVersion = cloneRecord(unavailableFixture);
    wrongVersion.performance_schema_version = '1.1';
    expect(() => parseHubLifetimePerformance(wrongVersion)).toThrow();

    const missingReasonCodes = cloneRecord(unavailableFixture);
    delete childRecord(missingReasonCodes, 'quality').reason_codes;
    expect(() => parseHubLifetimePerformance(missingReasonCodes)).toThrow();

    const missingAnchor = cloneRecord(unavailableFixture);
    delete childRecord(missingAnchor, 'lineage').lifetime_anchor_id;
    expect(() => parseHubLifetimePerformance(missingAnchor)).toThrow();
  });

  it('rejects a baseline-period response as lifetime performance', () => {
    expect(() => parseHubLifetimePerformance(baselineFixture)).toThrow();
  });

  it('requires matching top-level and nested opening equity when both are known', () => {
    const equivalent = cloneRecord(provisionalFixture);
    equivalent.opening_equity = '1000.0';
    childRecord(equivalent, 'performance').opening_equity = '1000.00';
    expect(() => parseHubLifetimePerformance(equivalent)).not.toThrow();

    const mismatch = cloneRecord(provisionalFixture);
    childRecord(mismatch, 'performance').opening_equity = '1000.01';
    expect(() => parseHubLifetimePerformance(mismatch)).toThrow(/opening equity/i);
  });

  it('requires both exact accounting identities when all operands are available', () => {
    const badFlow = cloneRecord(readyFixture);
    childRecord(badFlow, 'performance').net_capital_flow = '851.00';
    expect(() => parseHubLifetimePerformance(badFlow)).toThrow(/net capital flow/i);

    const badPnl = cloneRecord(readyFixture);
    childRecord(badPnl, 'performance').pnl = '151.00';
    expect(() => parseHubLifetimePerformance(badPnl)).toThrow(/P&L/i);
  });

  it('retains quality details only in the validated internal shape', () => {
    const raw = lifetimePerformanceDatapointSchema.parse(provisionalFixture);
    const normalized = parseHubLifetimePerformance(provisionalFixture);

    expect(raw.quality.details).toEqual(provisionalFixture.quality.details);
    expect(normalized.quality).not.toHaveProperty('details');
  });
});
