import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'

const root = resolve(process.cwd(), 'docs/integrations/2026-10-21-transaction-analytics')
const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const provider = 'provider/analytics_handoff'
const spec = read(`${provider}/openapi.json`)
const index = read('synthetic/index.json')
const summary = (name: string) => read(`synthetic/${name}.json`)
const profit = 'calculated_realized_gross_profit'
const parameters = spec.paths['/api/v1/accounts/{account_id}/analytics/summary'].get.parameters
const metricNames: string[] = parameters.find((p: { name: string }) => p.name === 'metric').schema.anyOf[0].enum

type Schema = {
  $ref?: string
  anyOf?: Schema[]
  type?: string
  enum?: unknown[]
  const?: unknown
  required?: string[]
  properties?: Record<string, Schema>
  additionalProperties?: Schema | boolean
  items?: Schema
}

// Capture-only checks for the structural keywords used in this supplied OpenAPI.
// Production validation and additive response handling belong to Package 2.
function checkShape(value: unknown, schema: Schema): void {
  if (schema.$ref) return checkShape(value, spec.components.schemas[schema.$ref.split('/').pop()!])
  if (schema.anyOf) {
    const alternatives = schema.anyOf.filter((s) => s.type === (value === null ? 'null' : typeof value) || (value !== null && s.$ref))
    expect(alternatives.length).toBeGreaterThan(0)
    return checkShape(value, alternatives[0])
  }
  if (schema.enum) expect(schema.enum).toContain(value)
  if ('const' in schema) expect(value).toEqual(schema.const)
  if (schema.type === 'null') expect(value).toBeNull()
  else if (schema.type === 'array') {
    expect(Array.isArray(value)).toBe(true)
    for (const item of value as unknown[]) checkShape(item, schema.items!)
  } else if (schema.type === 'object') {
    expect(value).not.toBeNull()
    expect(typeof value).toBe('object')
    const record = value as Record<string, unknown>
    for (const key of schema.required ?? []) expect(record).toHaveProperty(key)
    for (const [key, field] of Object.entries(record)) {
      const child = schema.properties?.[key] ?? schema.additionalProperties
      if (child && typeof child === 'object') checkShape(field, child)
    }
  } else if (schema.type === 'integer') expect(Number.isInteger(value)).toBe(true)
  else if (schema.type) expect(typeof value).toBe(schema.type)
}

function checkSummary(data: ReturnType<typeof read>) {
  checkShape(data, spec.components.schemas.AnalyticsSummary)
  expect(data).not.toHaveProperty('canonical_schema_version')
  for (const group of data.groups) {
    for (const dimension of ['currency', 'denomination', 'quantity_unit']) expect(group.dimensions).toHaveProperty(dimension)
    for (const [name, metric] of Object.entries(group.metrics)) {
      expect(metricNames).toContain(name)
      const { value, eligible_count: eligible, missing_count: missing } = metric as { value: string | null; eligible_count: number; missing_count: number }
      expect(eligible).toBeGreaterThanOrEqual(0)
      expect(missing).toBeGreaterThanOrEqual(0)
      expect(missing).toBeLessThanOrEqual(eligible)
      if (value !== null) {
        expect(typeof value).toBe('string')
        expect(new Decimal(value).isFinite()).toBe(true)
      }
    }
  }
}

describe('transaction analytics Package 1 contract capture', () => {
  it('keeps the supplied documentation and examples byte-for-byte with provider provenance', () => {
    const provenance = read('provenance.json')
    const manifest = read(`${provider}/manifest.json`)
    expect(manifest.fixture_ids_are_synthetic).toBe(true)
    expect(manifest.reference_examples_are_live_captures).toBe(false)
    for (const [path, hash] of Object.entries(provenance.copied_files_sha256)) {
      const actual = createHash('sha256').update(readFileSync(resolve(root, 'provider', path))).digest('hex')
      expect(actual, path).toBe(hash)
      if (path.startsWith('analytics_handoff/') && !path.endsWith('/manifest.json')) {
        expect(actual).toBe(manifest.files[path.replace('analytics_handoff/', '')])
      }
    }
  })

  it('covers all six synthetic account references across their actual three venue types', () => {
    const accounts = read(`${provider}/examples/accounts.json`).items
    const slugs = ['annamite', 'coincall', 'dwf', 'nickel', 'paradex', 'paradex-hype']
    expect(accounts).toHaveLength(6)
    expect(new Set(accounts.map((a: { venue: string }) => a.venue))).toEqual(new Set(['deribit', 'coincall', 'paradex']))
    for (const [i, slug] of slugs.entries()) {
      const data = read(`${provider}/examples/${slug}/summary.json`)
      const page = read(`${provider}/examples/${slug}/transactions.json`)
      checkSummary(data)
      checkShape(page, spec.components.schemas.AnalyticsTransactionPage)
      expect(data.account_id).toBe(accounts[i].id)
      expect(data.venue).toBe(accounts[i].venue)
      expect(page.account_id).toBe(data.account_id)
      expect(page.venue).toBe(data.venue)
      expect(data.coverage.history_complete).toBe(false)
      for (const row of page.items) {
        expect(row.account_id).toBe(page.account_id)
        expect(row.venue).toBe(page.venue)
      }
      for (const row of read(`${provider}/examples/${slug}/normalization-excerpts.json`)) {
        checkShape(row, spec.components.schemas.AnalyticsTransaction)
      }
    }
  })

  it.each(index.summary_scenarios as string[])('captures the synthetic %s response shape', (name) => {
    const data = summary(name)
    checkSummary(data)
    expect(data.coverage.notes.join(' ')).toContain('Synthetic UI illustration')
    expect(data.coverage.history_complete).toBe(false)
  })

  it('keeps all four schema processing states including neutral live', () => {
    expect(spec.components.schemas.AnalyticsCoverage.properties.derived_status.enum).toEqual(['live', 'pending', 'ready', 'stale'])
    for (const state of ['live', 'pending', 'stale']) expect(summary(state).coverage.derived_status).toBe(state)
    expect(summary('live').coverage.derived_at).toBeNull()
  })

  it('distinguishes partial, unavailable, explicit zero, ineligible and empty', () => {
    expect(summary('partial').groups[0].metrics[profit]).toMatchObject({ value: '-66.0000000000000000', eligible_count: 2, missing_count: 1 })
    expect(summary('unavailable').groups[0].metrics[profit]).toMatchObject({ value: null, eligible_count: 1, missing_count: 1 })
    expect(summary('unavailable').groups[0].metrics.net_funding.value).toBeNull()
    expect(summary('unavailable').groups[0].metrics.fee_expense.value).toBe('1.25')
    expect(summary('explicit-zero').groups[0].metrics[profit].value).toBe('0')
    expect(summary('ineligible').groups[0].metrics).not.toHaveProperty(profit)
    expect(summary('empty').groups).toEqual([])
  })

  it('covers costs, signed funding and distinct exact activity measures', () => {
    const metrics = summary('costs-funding-activity').groups[0].metrics
    expect(Object.keys(metrics)).toEqual(expect.arrayContaining(['fee_expense', 'rebates', 'net_trading_cost', 'net_funding', 'source_reported_funding', 'execution_count', 'executed_quantity', 'premium_turnover', 'notional_turnover']))
    expect(metrics.net_funding.value).toBe('-0.125')
    expect(metrics.execution_count.value).toBe('2')
    expect(metrics.executed_quantity.value).toBe('0.020000000000000001')
    expect(metrics.premium_turnover.value).not.toBe(metrics.notional_turnover.value)
    const received = summary('net-rebate-funding-received').groups[0].metrics
    expect(received.net_trading_cost.value).toBe('-1.00')
    expect(received.net_funding.value).toBe('0.125')
  })

  it('preserves same-currency denomination and quantity-unit partitions plus unknowns', () => {
    const groups = summary('multiple-partitions').groups
    expect(new Set(groups.map((g: { dimensions: unknown }) => JSON.stringify(g.dimensions))).size).toBe(5)
    const usd = groups.filter((g: { dimensions: { currency: string } }) => g.dimensions.currency === 'USD')
    expect(usd).toHaveLength(3)
    expect(new Set(usd.map((g: { dimensions: { denomination: string } }) => g.dimensions.denomination)).size).toBe(2)
    expect(new Set(usd.map((g: { dimensions: { quantity_unit: string } }) => g.dimensions.quantity_unit)).size).toBe(2)
    expect(groups[4].dimensions).toMatchObject({ currency: null, quantity_unit: null })
  })

  it('retains the absent day between a selectable zero and partial negative day', () => {
    const data = summary('daily-profit')
    expect(data.group_by).toEqual(['day'])
    expect(data.groups.map((g: { dimensions: { day: string } }) => g.dimensions.day)).toEqual(['2026-10-05', '2026-10-07'])
    expect(data.groups[0].metrics[profit].value).toBe('0')
    expect(data.groups[1].metrics[profit].missing_count).toBe(1)
  })

  it('traces the synthetic partial subtotal through two consistent detail pages', () => {
    const total = summary('partial')
    const pages = (index.detail_sequence as string[]).map((path) => read(`synthetic/${path}`))
    expect(pages[0].next_cursor).toEqual(expect.any(String))
    expect(pages[1].next_cursor).toBeNull()
    for (const page of pages) {
      checkShape(page, spec.components.schemas.AnalyticsTransactionPage)
      expect(page.account_id).toBe(total.account_id)
      expect(page.venue).toBe(total.venue)
      expect(page.coverage).toEqual(total.coverage)
    }
    const rows = pages.flatMap((p) => p.items)
    expect(new Set(rows.map((r) => r.id)).size).toBe(2)
    const cell = total.groups[0].metrics[profit]
    expect(rows).toHaveLength(cell.eligible_count)
    expect(rows.filter((r) => r.metrics[profit] === null)).toHaveLength(cell.missing_count)
    const sum = rows.reduce((acc, row) => acc.plus(row.metrics[profit] ?? '0'), new Decimal(0))
    expect(sum.eq(cell.value)).toBe(true)
    for (const row of rows) {
      expect(row.account_id).toBe(total.account_id)
      expect(row.venue).toBe(total.venue)
      for (const field of ['currency', 'denomination', 'quantity_unit']) expect(row[field]).toBe(total.groups[0].dimensions[field])
    }
    expect(rows[1].missing_data[profit]).toBe('unwind_transfer_basis_unresolved')
    expect(rows[1].accounting.reason_codes).toContain('unwind_transfer_basis_unresolved')
  })
})
