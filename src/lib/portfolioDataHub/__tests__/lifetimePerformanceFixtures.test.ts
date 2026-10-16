import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import readyFixture from '../__fixtures__/performance/lifetime-ready.json';
import provisionalFixture from '../__fixtures__/performance/lifetime-provisional.json';
import unavailableFixture from '../__fixtures__/performance/lifetime-unavailable.json';

const fixtures = [readyFixture, provisionalFixture, unavailableFixture] as const;

describe('Portfolio Data Hub lifetime performance fixtures', () => {
  it.each([
    ['ready', readyFixture, 'ready'],
    ['provisional', provisionalFixture, 'provisional'],
    ['unavailable', unavailableFixture, 'unavailable'],
  ] as const)('pins a sanitized %s response', (_name, fixture, expectedStatus) => {
    expect(fixture.performance_schema_version).toBe('1.0');
    expect(fixture.account_id).toBe('00000000-0000-4000-8000-000000000001');
    expect(fixture.quality.performance_status).toBe(expectedStatus);
    expect(Object.keys(fixture.lineage)).toEqual(expect.arrayContaining([
      'lifetime_anchor_id',
      'start_event_id',
      'start_at',
      'opening_basis',
      'canonical_input_sequence',
      'classification_sequence',
    ]));
    expect(fixture.lineage.canonical_input_sequence).toEqual(expect.any(Number));
    expect(fixture.lineage.classification_sequence).toEqual(expect.any(Number));
    expect(fixture.lineage).not.toHaveProperty('baseline_snapshot_id');
    expect(fixture.lineage).not.toHaveProperty('baseline_at');
  });

  it('pins all exact lifetime totals and their accounting identities', () => {
    for (const fixture of [readyFixture, provisionalFixture]) {
      const performance = fixture.performance;
      expect(Object.keys(performance)).toEqual([
        'opening_equity',
        'contributions',
        'distributions',
        'transfers_in',
        'transfers_out',
        'net_capital_flow',
        'pnl',
      ]);
      for (const value of [fixture.equity, ...Object.values(performance)]) {
        expect(typeof value).toBe('string');
      }

      const netCapitalFlow = new Decimal(performance.contributions)
        .minus(performance.distributions)
        .plus(performance.transfers_in)
        .minus(performance.transfers_out);
      expect(netCapitalFlow.equals(performance.net_capital_flow)).toBe(true);

      const pnl = new Decimal(fixture.equity)
        .minus(performance.opening_equity)
        .minus(performance.net_capital_flow);
      expect(pnl.equals(performance.pnl)).toBe(true);
    }
  });

  it('uses null rather than zero for unavailable financial values', () => {
    expect(unavailableFixture.equity).toBeNull();
    expect(unavailableFixture.opening_equity).toBeNull();
    expect(unavailableFixture.performance).toBeNull();
  });

  it('includes representative ready, provisional, and unavailable reason-code states', () => {
    const fixtureReasons = new Set(fixtures.flatMap((fixture) => fixture.quality.reason_codes));
    expect(fixtureReasons).toEqual(new Set([
      'movement_unresolved',
      'snapshot_time_approximate',
      'policy_not_configured',
    ]));
  });
});
