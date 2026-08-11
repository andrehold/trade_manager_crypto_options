import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import contractSnapshot from '../contract/openapi.v1.json';
import accountsFixture from '../__fixtures__/accounts.json';
import deribitSummary from '../__fixtures__/deribit/summary-latest.json';
import deribitPositions from '../__fixtures__/deribit/positions-latest.json';
import deribitLedger from '../__fixtures__/deribit/ledger-events.json';
import coincallSummary from '../__fixtures__/coincall/summary-latest.json';
import coincallPositions from '../__fixtures__/coincall/positions-latest.json';
import coincallLedger from '../__fixtures__/coincall/ledger-events.json';
import paradexSummary from '../__fixtures__/paradex/summary-latest.json';
import paradexPositions from '../__fixtures__/paradex/positions-latest.json';
import paradexLedger from '../__fixtures__/paradex/ledger-events.json';
import {
  decimalFrom,
  parseHubAccountPage,
  parseHubLatestPositionPage,
  parseHubLedgerEventPage,
  parseHubSummary,
  summarySchema,
} from '..';

const venueFixtures = {
  deribit: { summary: deribitSummary, positions: deribitPositions, ledger: deribitLedger },
  coincall: { summary: coincallSummary, positions: coincallPositions, ledger: coincallLedger },
  paradex: { summary: paradexSummary, positions: paradexPositions, ledger: paradexLedger },
} as const;

describe('Portfolio Data Hub Canonical Contract v1', () => {
  it.each(['deribit', 'coincall', 'paradex'] as const)(
    'parses the sanitized %s summary, positions, and ledger fixtures',
    (venue) => {
      const fixture = venueFixtures[venue];
      const summary = parseHubSummary(fixture.summary);
      const positions = parseHubLatestPositionPage(fixture.positions);
      const ledger = parseHubLedgerEventPage(fixture.ledger);

      expect(summary.venue).toBe(venue);
      expect(positions.snapshot.venue).toBe(venue);
      expect(positions.items).toHaveLength(positions.snapshot.positionCount);
      expect(ledger.items[0]?.venue).toBe(venue);
    },
  );

  it('parses all supplied Hub accounts into portal-facing account identities', () => {
    const accounts = parseHubAccountPage(accountsFixture);

    expect(accounts.nextCursor).toBeNull();
    expect(accounts.items.map((account) => account.venue)).toEqual(['deribit', 'coincall', 'paradex']);
    expect(accounts.items[0]).toMatchObject({
      id: 'd0000000-0000-4000-8000-000000000001',
      externalAccountIdentifier: 'deribit-account-42',
      enabled: true,
    });
  });

  it('normalizes the complete canonical provenance carried by the supplied records', () => {
    const summary = parseHubSummary(deribitSummary);
    const positionPage = parseHubLatestPositionPage(deribitPositions);
    const position = positionPage.items[0];
    const ledger = parseHubLedgerEventPage(deribitLedger).items[0];

    expect(summary).toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      accountId: 'd0000000-0000-4000-8000-000000000001',
      accountLabel: 'Deribit primary',
      runId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      fetchedAt: '2026-07-29T12:00:00Z',
      processingVersion: 'deribit-v1',
      venue: 'deribit',
      sourceRawBatchId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
      ingestedAt: '2026-07-29T12:00:01Z',
    });
    expect(positionPage.snapshot).toMatchObject({
      id: '11111111-1111-4111-8111-111111111112',
      accountId: 'd0000000-0000-4000-8000-000000000001',
      accountLabel: 'Deribit primary',
      runId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      fetchedAt: '2026-07-29T12:00:00Z',
      processingVersion: 'deribit-v1',
      venue: 'deribit',
      sourceRawBatchId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
      ingestedAt: '2026-07-29T12:00:01Z',
    });
    expect(position).toMatchObject({
      id: '11111111-1111-4111-8111-111111111113',
      snapshotId: '11111111-1111-4111-8111-111111111112',
      accountId: 'd0000000-0000-4000-8000-000000000001',
      accountLabel: 'Deribit primary',
      runId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      processingVersion: 'deribit-v1',
      venue: 'deribit',
      sourceRawBatchId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
      ingestedAt: '2026-07-29T12:00:01Z',
    });
    expect(ledger).toMatchObject({
      id: '11111111-1111-4111-8111-111111111114',
      accountId: 'd0000000-0000-4000-8000-000000000001',
      accountLabel: 'Deribit primary',
      runId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      processingVersion: 'deribit-v1',
      venue: 'deribit',
      sourceRawBatchId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
      ingestedAt: '2026-07-29T12:00:01Z',
    });
  });

  it('keeps exact decimal strings and null as unknown, not zero', () => {
    const deribit = parseHubSummary(deribitSummary);
    const coincallPositionPage = parseHubLatestPositionPage(coincallPositions);
    const coincallLedgerPage = parseHubLedgerEventPage(coincallLedger);

    expect(deribit.components[0]?.equity).toBe('2.345678901234567890');
    expect(coincallPositionPage.items[0]?.unrealizedPnl).toBe('966.11000000000100000000');
    expect(coincallPositionPage.items[0]?.notionalUnit).toBe('USD');
    expect(coincallPositionPage.items[0]?.indexPrice).toBe('119000.12');
    expect(coincallLedgerPage.items[0]?.quantity).toBeNull();
    expect(coincallLedgerPage.items[0]?.price).toBeNull();
    expect(coincallLedgerPage.items[0]?.deduplicationKey).toBe('coincall:funding:fund-1');

    const exact = decimalFrom(deribit.components[0]!.equity!);
    expect(exact.plus('0.000000000000000001').toString()).toBe('2.345678901234567891');
  });

  it('retains documented absent venue observation timestamps', () => {
    const paradex = parseHubSummary(paradexSummary);
    const positions = parseHubLatestPositionPage(paradexPositions);

    expect(paradex.venueObservedAt).toBeNull();
    expect(positions.snapshot.venueObservedAt).toBeNull();
  });

  it('tolerates additive unknown fields without weakening documented fields', () => {
    const input = structuredClone(deribitSummary) as Record<string, unknown>;
    input.future_top_level = { value: 'accepted' };
    const components = input.components as Array<Record<string, unknown>>;
    components[0]!.future_component_field = true;

    const parsed = summarySchema.parse(input);
    expect(parsed.future_top_level).toEqual({ value: 'accepted' });
    expect(parsed.components[0]?.future_component_field).toBe(true);
    expect(parseHubSummary(input).components[0]?.equity).toBe('2.345678901234567890');
  });

  it('fails closed for an unsupported Canonical Contract major version', () => {
    const input = structuredClone(deribitSummary) as Record<string, unknown>;
    input.canonical_schema_version = '2.0';

    expect(() => parseHubSummary(input)).toThrow(/Unsupported Canonical Contract major version/);
  });

  it('distinguishes complete-empty and partial position snapshots', () => {
    const completeEmpty = structuredClone(deribitPositions) as Record<string, unknown>;
    completeEmpty.items = [];
    (completeEmpty.snapshot as Record<string, unknown>).position_count = 0;
    (completeEmpty.snapshot as Record<string, unknown>).status = 'complete';

    const partial = structuredClone(completeEmpty);
    (partial.snapshot as Record<string, unknown>).status = 'partial';

    expect(parseHubLatestPositionPage(completeEmpty).snapshot).toMatchObject({
      positionCount: 0,
      quality: 'complete',
    });
    expect(parseHubLatestPositionPage(partial).snapshot).toMatchObject({
      positionCount: 0,
      quality: 'partial',
    });
  });

  it('keeps the authoritative Hub OpenAPI v1 handoff artifact and consumed schema surface', () => {
    const bytes = readFileSync(resolve(process.cwd(), 'src/lib/portfolioDataHub/contract/openapi.v1.json'));
    const hash = createHash('sha256').update(bytes).digest('hex');

    expect(hash).toBe('b29e27316d0d85423a22071e9437134fbf11a9585aaa6395ce258d6d05c52c31');
    expect(contractSnapshot.openapi).toBe('3.1.0');
    expect(contractSnapshot.info.version).toBe('1.0');
    expect(contractSnapshot.paths['/api/v1/accounts/{account_id}/positions/latest']?.get.responses['200']
      ?.content['application/json'].schema.$ref).toBe('#/components/schemas/LatestPositionPage');
    expect(contractSnapshot.components.schemas.LatestPositionPage.required).toEqual([
      'canonical_schema_version', 'items', 'snapshot',
    ]);
    expect(contractSnapshot.components.schemas.LedgerEventView.properties.deduplication_key).toBeDefined();
  });
});
