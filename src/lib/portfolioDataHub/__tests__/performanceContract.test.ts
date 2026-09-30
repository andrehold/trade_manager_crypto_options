import { describe, expect, it } from 'vitest';
import readyFixture from '../__fixtures__/performance/ready.json';
import provisionalFixture from '../__fixtures__/performance/provisional.json';
import unavailableFixture from '../__fixtures__/performance/unavailable.json';
import { parseHubPerformance, performanceDatapointSchema } from '..';

function cloneRecord(value: unknown): Record<string, unknown> {
  return structuredClone(value) as Record<string, unknown>;
}

function childRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  return parent[key] as Record<string, unknown>;
}

describe('Portfolio Data Hub performance contract', () => {
  it.each([
    ['ready', readyFixture, 'ready'],
    ['provisional', provisionalFixture, 'provisional'],
    ['unavailable', unavailableFixture, 'unavailable'],
  ] as const)('parses the sanitized %s fixture', (_name, fixture, performanceStatus) => {
    const result = parseHubPerformance(fixture);

    expect(result.quality.performanceStatus).toBe(performanceStatus);
    expect(result.accountId).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('normalizes all seven exact performance totals without converting null to zero', () => {
    const provisional = parseHubPerformance(provisionalFixture);
    const unavailable = parseHubPerformance(unavailableFixture);

    expect(provisional.performance).toEqual({
      openingEquity: '9000.00',
      contributions: '200.00',
      distributions: '50.00',
      transfersIn: '800.00',
      transfersOut: '100.00',
      netCapitalFlow: '850.00',
      pnl: '150.00',
    });
    expect(unavailable.openingEquity).toBeNull();
    expect(unavailable.performance).toBeNull();
  });

  it('keeps equity and performance statuses independent', () => {
    const result = parseHubPerformance(provisionalFixture);

    expect(result.quality).toMatchObject({
      equityStatus: 'ready',
      performanceStatus: 'provisional',
      freshness: 'fresh',
      recalculationPending: false,
      reasonCodes: ['snapshot_time_approximate'],
    });
    expect(result.timeBasis).toBe('collected_at');
  });

  it('normalizes complete quality and lineage without exposing opaque details', () => {
    const result = parseHubPerformance(provisionalFixture);

    expect(result.quality).toEqual({
      equityStatus: 'ready',
      performanceStatus: 'provisional',
      freshness: 'fresh',
      recalculationPending: false,
      unresolvedMovementCount: 0,
      ledgerCoverageFrom: '2026-01-01T00:00:00Z',
      ledgerCoverageThrough: '2026-01-01T00:00:00Z',
      reasonCodes: ['snapshot_time_approximate'],
    });
    expect(result.lineage).toEqual({
      summarySnapshotId: '00000000-0000-4000-8000-000000000003',
      baselineSnapshotId: '00000000-0000-4000-8000-000000000004',
      baselineAt: '2026-01-01T00:00:00Z',
      canonicalInputSequence: 1200,
      classificationSequence: 87,
      policyRevision: 3,
      calculationVersion: 'performance-v1',
    });
    expect(result.quality).not.toHaveProperty('details');
  });

  it('accepts integer, null, and omitted revisions while rejecting strings and fractions', () => {
    const nullable = cloneRecord(provisionalFixture);
    nullable.revision = null;
    childRecord(nullable, 'lineage').policy_revision = null;
    expect(parseHubPerformance(nullable)).toMatchObject({
      revision: null,
      lineage: { policyRevision: null },
    });

    const omitted = cloneRecord(provisionalFixture);
    delete omitted.revision;
    delete childRecord(omitted, 'lineage').policy_revision;
    expect(parseHubPerformance(omitted)).toMatchObject({
      revision: null,
      lineage: { policyRevision: null },
    });

    for (const invalid of ['7', 7.5]) {
      const invalidRevision = cloneRecord(provisionalFixture);
      invalidRevision.revision = invalid;
      expect(() => parseHubPerformance(invalidRevision)).toThrow();

      const invalidPolicyRevision = cloneRecord(provisionalFixture);
      childRecord(invalidPolicyRevision, 'lineage').policy_revision = invalid;
      expect(() => parseHubPerformance(invalidPolicyRevision)).toThrow();
    }
  });

  it('preserves exact decimal strings including zero and negative zero', () => {
    const input = cloneRecord(provisionalFixture);
    input.equity = '-0';
    input.opening_equity = '0.00';
    const totals = childRecord(input, 'performance');
    totals.opening_equity = '0';
    totals.contributions = null;
    totals.pnl = '0e-8';

    const result = parseHubPerformance(input);
    expect(result.equity).toBe('-0');
    expect(result.openingEquity).toBe('0.00');
    expect(result.performance?.openingEquity).toBe('0');
    expect(result.performance?.contributions).toBeNull();
    expect(result.performance?.pnl).toBe('0e-8');

    const malformed = cloneRecord(input);
    childRecord(malformed, 'performance').pnl = 'not-a-decimal';
    expect(() => parseHubPerformance(malformed)).toThrow(/exact decimal string/i);
  });

  it('rejects unknown status and freshness values', () => {
    for (const [field, value] of [
      ['equity_status', 'pending'],
      ['performance_status', 'complete'],
      ['freshness', 'old'],
    ] as const) {
      const input = cloneRecord(provisionalFixture);
      childRecord(input, 'quality')[field] = value;
      expect(() => parseHubPerformance(input)).toThrow();
    }
  });

  it('accepts stale freshness as distinct from performance completeness', () => {
    const input = cloneRecord(provisionalFixture);
    childRecord(input, 'quality').freshness = 'stale';

    const result = parseHubPerformance(input);
    expect(result.quality.freshness).toBe('stale');
    expect(result.quality.performanceStatus).toBe('provisional');
  });

  it('accepts unknown non-empty reason codes and rejects empty ones', () => {
    const futureReason = cloneRecord(provisionalFixture);
    childRecord(futureReason, 'quality').reason_codes = ['future_hub_reason'];
    expect(parseHubPerformance(futureReason).quality.reasonCodes).toEqual(['future_hub_reason']);

    for (const reason of ['', '   ']) {
      const invalid = cloneRecord(provisionalFixture);
      childRecord(invalid, 'quality').reason_codes = [reason];
      expect(() => parseHubPerformance(invalid)).toThrow(/reason code/i);
    }
  });

  it('normalizes documented defaults for omitted nullable and defaulted fields', () => {
    const result = parseHubPerformance({
      account_id: '00000000-0000-4000-8000-000000000001',
      quality: {
        equity_status: 'unavailable',
        performance_status: 'unavailable',
        freshness: 'unknown',
        recalculation_pending: false,
      },
      lineage: {},
    });

    expect(result).toMatchObject({
      performanceSchemaVersion: '1.0',
      id: null,
      revision: null,
      asOf: null,
      timeBasis: 'venue_observed',
      computedAt: null,
      reportingCurrency: null,
      equity: null,
      openingEquity: null,
      performance: null,
      quality: {
        unresolvedMovementCount: 0,
        ledgerCoverageFrom: null,
        ledgerCoverageThrough: null,
        reasonCodes: [],
      },
      lineage: {
        summarySnapshotId: null,
        baselineSnapshotId: null,
        baselineAt: null,
        canonicalInputSequence: 0,
        classificationSequence: 0,
        policyRevision: null,
        calculationVersion: null,
      },
    });
  });

  it('requires matching top-level and nested opening equity when both are known', () => {
    const equivalent = cloneRecord(provisionalFixture);
    equivalent.opening_equity = '1000.0';
    childRecord(equivalent, 'performance').opening_equity = '1000.00';
    expect(() => parseHubPerformance(equivalent)).not.toThrow();

    const mismatch = cloneRecord(provisionalFixture);
    childRecord(mismatch, 'performance').opening_equity = '1000.01';
    expect(() => parseHubPerformance(mismatch)).toThrow(/opening equity/i);
  });

  it('retains quality details only in the validated internal shape', () => {
    const raw = performanceDatapointSchema.parse(provisionalFixture);
    const normalized = parseHubPerformance(provisionalFixture);

    expect(raw.quality.details).toEqual(provisionalFixture.quality.details);
    expect(normalized.quality).not.toHaveProperty('details');
  });
});
