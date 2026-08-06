import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useClientPositions } from '../useClientPositions'
import { useSetupPersistence } from '../useSetupPersistence'
import { DEFAULT_RISK_LIMITS } from '../risk/riskLimits'
import { hasSupabaseClient } from '@/lib/supabase'

// Recharts' ResponsiveContainer measures 0×0 in jsdom; give it a fixed size.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 200 }}>{children}</div>
    ),
  }
})

vi.mock('../useClientPositions')
const mockedHook = vi.mocked(useClientPositions)

vi.mock('../useSetupPersistence', () => ({ useSetupPersistence: vi.fn() }))

// Isolate the shell's own `hasSupabaseClient()` check (used for the SEED-fallback decision) from
// whatever real Supabase env vars happen to be configured locally (e.g. via .env.local) — tests
// must exercise the "no DB configured" branch deterministically, not the developer's local setup.
// A vi.fn (default false) lets individual tests override it to exercise the "DB configured" branch too.
// getSupabaseClient is stubbed as a self-chaining thenable query builder: flipping
// hasSupabaseClient to true also arms usePositionInterventions' fetch effect (it's mounted
// unconditionally by the shell regardless of page), so getSupabaseClient must resolve to
// something that satisfies `.from().select().order().eq()` → `{ data: [], error: null }`
// rather than leaving that effect to throw into an unhandled rejection.
vi.mock('@/lib/supabase', () => {
  const queryBuilder: any = {
    select: () => queryBuilder,
    order: () => queryBuilder,
    eq: () => queryBuilder,
    insert: () => Promise.resolve({ error: null }),
    then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: [], error: null }),
  }
  return {
    hasSupabaseClient: vi.fn(() => false),
    getSupabaseClient: vi.fn(() => ({ from: () => queryBuilder })),
  }
})

const ACTIVE_KEY = { keyRef: 'r1', venue: 'Deribit', label: 'main', fingerprint: null, scopes: 'trade,read', noWithdrawal: true, ts: '1' }

const baseSetupPersistence = {
  loaded: true, appropriatenessSigned: false, selectedStrategy: null, savedRiskLimits: null, activeKeys: [], persistedActive: false, approvedVersions: [], persistedAudit: [],
  saveAppropriateness: vi.fn(async () => ({ ok: true })),
  saveStrategy: vi.fn(async () => ({ ok: true })),
  saveRiskLimits: vi.fn(async () => ({ ok: true })),
  addExchangeKey: vi.fn(async () => ({ ok: true, keyRef: 'k-new' })),
  revokeExchangeKey: vi.fn(async () => ({ ok: true })),
  saveActivation: vi.fn(async () => ({ ok: true })),
  saveUpdateApproval: vi.fn(async () => ({ ok: true })),
  saveAuditEvent: vi.fn(async () => ({ ok: true })),
}

beforeEach(() => {
  mockedHook.mockReturnValue({ positions: [], loading: false, error: null, reload: vi.fn() })
  // Reset the persistence mock every test so a per-test override never leaks forward.
  vi.mocked(useSetupPersistence).mockReturnValue(baseSetupPersistence)
  // Reset the Supabase-configured flag every test so a per-test override never leaks forward.
  vi.mocked(hasSupabaseClient).mockReturnValue(false)
})

import { ClientPortalShell } from '../ClientPortalShell'

describe('ClientPortalShell', () => {
  it('renders the sidebar, activation control, and the routed page', () => {
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/dashboard" onSignOut={() => {}} />)
    expect(screen.getByText('TwoPrime')).toBeInTheDocument()
    expect(screen.getByText(/^software$/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument()
  })

  it('routes to Positions from the hash', () => {
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/positions" onSignOut={() => {}} />)
    expect(screen.getByRole('heading', { name: /positions/i })).toBeInTheDocument()
  })

  it('shows an error banner with a working retry when the fetch failed', async () => {
    const reload = vi.fn()
    mockedHook.mockReturnValue({ positions: [], loading: false, error: 'network down', reload })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/positions" onSignOut={() => {}} />)
    expect(screen.getByText(/could not load your positions/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(reload).toHaveBeenCalledOnce()
  })

  it('renders the Risk page and flips the risk setup status on apply', async () => {
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/risk" onSignOut={() => {}} />)
    expect(screen.getByRole('heading', { name: /risk & deployment/i })).toBeInTheDocument()
    // Risk sidebar item shows the amber "attention" dot before applying (no check)
    await userEvent.click(screen.getAllByRole('button', { name: /apply deployment/i })[0])
    // After applying, the activation control's outstanding list no longer includes "Risk limits"
    const activate = screen.getByRole('button', { name: /activate/i })
    expect(activate.getAttribute('title') ?? '').not.toMatch(/risk limits/i)
  })

  it('renders the audit log with seed entries', () => {
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/audit" onSignOut={() => {}} />)
    expect(screen.getByRole('heading', { name: /audit log/i })).toBeInTheDocument()
    expect(screen.getByText(/self-assessment completed & signed/i)).toBeInTheDocument()
  })

  it('shows the empty-state (not the seed) when Supabase is configured and the log is empty', async () => {
    vi.mocked(hasSupabaseClient).mockReturnValue(true)
    vi.mocked(useSetupPersistence).mockReturnValue({ ...baseSetupPersistence, persistedAudit: [] })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/audit" onSignOut={() => {}} />)
    // findBy (vs getBy) flushes pending effects — flipping hasSupabaseClient true also arms the
    // unrelated usePositionInterventions fetch effect, whose resolution must settle inside act().
    expect(await screen.findByRole('heading', { name: /audit log/i })).toBeInTheDocument()
    expect(screen.queryByText(/self-assessment completed & signed/i)).toBeNull()
    expect(screen.getByText(/no entries/i)).toBeInTheDocument()
  })

  it('enables activation after all four setup preconditions are met', async () => {
    const base = { clientName: 'TwoPrime', program: 'Obsidian Core', onSignOut: () => {} }
    const { rerender } = render(<ClientPortalShell {...base} hash="#/portal/appropriateness" />)
    for (const cb of screen.getAllByRole('checkbox')) await userEvent.click(cb)
    await userEvent.click(screen.getByRole('button', { name: /sign & complete/i }))
    rerender(<ClientPortalShell {...base} hash="#/portal/strategy" />)
    await userEvent.click(screen.getByRole('button', { name: /apply selection/i }))
    rerender(<ClientPortalShell {...base} hash="#/portal/keys" />)
    await userEvent.click(screen.getByRole('button', { name: /add key/i }))
    await userEvent.type(screen.getByLabelText('Label'), 'Deribit — main')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))
    rerender(<ClientPortalShell {...base} hash="#/portal/risk" />)
    await userEvent.click(screen.getAllByRole('button', { name: /apply deployment/i })[0])
    expect(screen.getByRole('button', { name: /^activate$/i })).toBeEnabled()
  })

  it('flags a position as Modified after the client clicks Modify', async () => {
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/positions" onSignOut={() => {}} />)
    expect(screen.queryByText('Modified')).toBeNull()
    await userEvent.click(screen.getAllByRole('button', { name: /^modify$/i })[0])
    expect(screen.getAllByText('Modified').length).toBeGreaterThan(0)
  })

  it('seeds the appropriateness precondition from persisted state on load', async () => {
    // Stable override (reset by beforeEach): the shell calls the hook every render and the
    // seeding effect triggers a re-render, so the returned object must stay stable — matching
    // the real hook (backed by useState) rather than weakening the assertion.
    vi.mocked(useSetupPersistence).mockReturnValue({
      loaded: true, appropriatenessSigned: true, selectedStrategy: 'Obsidian Core Yield', savedRiskLimits: null, activeKeys: [], persistedActive: false, approvedVersions: [], persistedAudit: [],
      saveAppropriateness: vi.fn(async () => ({ ok: true })),
      saveStrategy: vi.fn(async () => ({ ok: true })),
      saveRiskLimits: vi.fn(async () => ({ ok: true })),
      addExchangeKey: vi.fn(async () => ({ ok: true, keyRef: 'k-new' })),
      revokeExchangeKey: vi.fn(async () => ({ ok: true })),
      saveActivation: vi.fn(async () => ({ ok: true })),
      saveUpdateApproval: vi.fn(async () => ({ ok: true })),
      saveAuditEvent: vi.fn(async () => ({ ok: true })),
    })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/appropriateness" onSignOut={() => {}} />)
    await screen.findByText(/completed & signed/i)
  })

  it('shows an error banner and does not sign when the save fails', async () => {
    vi.mocked(useSetupPersistence).mockReturnValue({
      loaded: true, appropriatenessSigned: false, selectedStrategy: null, savedRiskLimits: null, activeKeys: [], persistedActive: false, approvedVersions: [], persistedAudit: [],
      saveAppropriateness: vi.fn(async () => ({ ok: false, error: 'network down' })),
      saveStrategy: vi.fn(async () => ({ ok: true })),
      saveRiskLimits: vi.fn(async () => ({ ok: true })),
      addExchangeKey: vi.fn(async () => ({ ok: true, keyRef: 'k-new' })),
      revokeExchangeKey: vi.fn(async () => ({ ok: true })),
      saveActivation: vi.fn(async () => ({ ok: true })),
      saveUpdateApproval: vi.fn(async () => ({ ok: true })),
      saveAuditEvent: vi.fn(async () => ({ ok: true })),
    })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/appropriateness" onSignOut={() => {}} />)
    for (const cb of screen.getAllByRole('checkbox')) await userEvent.click(cb)
    await userEvent.click(screen.getByRole('button', { name: /sign & complete/i }))
    expect(await screen.findByText(/network down/i)).toBeInTheDocument()
    // Precondition not flipped: the header pill still reads "Not completed".
    expect(screen.getByText(/not completed/i)).toBeInTheDocument()
  })

  it('seeds the risk precondition from persisted risk limits on load', async () => {
    // netDeltaMaxPct: 37 is distinctive (default is 10, and no other RiskLimits field defaults
    // to 37) and RiskPage renders it both as text ("|Δ| ≤ 37% TVL") and as the "Net delta cap"
    // input's value, so finding it proves riskLimits was actually set to the persisted object —
    // not left null and silently falling back to DEFAULT_RISK_LIMITS (which the precondition
    // check alone can't distinguish).
    const seededRiskLimits = { ...DEFAULT_RISK_LIMITS, netDeltaMaxPct: 37 }
    vi.mocked(useSetupPersistence).mockReturnValue({
      ...baseSetupPersistence, savedRiskLimits: seededRiskLimits,
    })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/risk" onSignOut={() => {}} />)
    // With the risk precondition seeded, the disabled activate button's outstanding list omits "Risk limits".
    await waitFor(() => {
      const activate = screen.getByRole('button', { name: /^activate$/i })
      expect(activate.getAttribute('title') ?? '').not.toMatch(/risk limits/i)
    })
    // The seeded *values* were restored (not just the precondition flag): the distinctive
    // netDeltaMaxPct surfaces in the "Net delta cap" input.
    expect(screen.getByLabelText('Net delta cap')).toHaveValue(37)
  })

  it('shows an error banner and does not flip the risk precondition when the save fails', async () => {
    vi.mocked(useSetupPersistence).mockReturnValue({
      ...baseSetupPersistence, saveRiskLimits: vi.fn(async () => ({ ok: false, error: 'risk save failed' })),
    })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/risk" onSignOut={() => {}} />)
    await userEvent.click(screen.getAllByRole('button', { name: /apply deployment/i })[0])
    expect(await screen.findByText(/risk save failed/i)).toBeInTheDocument()
    // Precondition not flipped: the activate button still lists "Risk limits" as outstanding.
    const activate = screen.getByRole('button', { name: /^activate$/i })
    expect(activate.getAttribute('title') ?? '').toMatch(/risk limits/i)
  })

  it('seeds the trading-key precondition and list from persisted keys on load', async () => {
    vi.mocked(useSetupPersistence).mockReturnValue({
      ...baseSetupPersistence,
      activeKeys: [{ keyRef: 'r1', venue: 'Deribit', label: 'Seeded — main', fingerprint: null, scopes: 'trade,read', noWithdrawal: true, ts: '1' }],
    })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/keys" onSignOut={() => {}} />)
    await screen.findByText('Seeded — main')
    const activate = screen.getByRole('button', { name: /^activate$/i })
    expect(activate.getAttribute('title') ?? '').not.toMatch(/trading api key/i)
  })

  it('shows an error banner and does not flip the trading-key precondition when the add fails', async () => {
    vi.mocked(useSetupPersistence).mockReturnValue({
      ...baseSetupPersistence,
      addExchangeKey: vi.fn(async () => ({ ok: false, error: 'key save failed' })),
    })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/keys" onSignOut={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /add key/i }))
    await userEvent.type(screen.getByLabelText('Label'), 'Deribit — main')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))
    expect(await screen.findByText(/key save failed/i)).toBeInTheDocument()
    const activate = screen.getByRole('button', { name: /^activate$/i })
    expect(activate.getAttribute('title') ?? '').toMatch(/trading api key/i)
  })

  it('revoking the last active key demotes the trading-key precondition', async () => {
    vi.mocked(useSetupPersistence).mockReturnValue({
      ...baseSetupPersistence,
      activeKeys: [{ keyRef: 'r1', venue: 'Deribit', label: 'Only — key', fingerprint: null, scopes: 'trade,read', noWithdrawal: true, ts: '1' }],
      revokeExchangeKey: vi.fn(async () => ({ ok: true })),
    })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/keys" onSignOut={() => {}} />)
    const activateBefore = screen.getByRole('button', { name: /^activate$/i })
    expect(activateBefore.getAttribute('title') ?? '').not.toMatch(/trading api key/i)
    await userEvent.click(screen.getByRole('button', { name: /revoke/i }))
    expect(screen.getByText(/no keys registered yet/i)).toBeInTheDocument()
    const activateAfter = screen.getByRole('button', { name: /^activate$/i })
    expect(activateAfter.getAttribute('title') ?? '').toMatch(/trading api key/i)
  })

  it('shows an error banner and keeps the key when the revoke fails', async () => {
    vi.mocked(useSetupPersistence).mockReturnValue({
      ...baseSetupPersistence,
      activeKeys: [{ keyRef: 'r1', venue: 'Deribit', label: 'Only — key', fingerprint: null, scopes: 'trade,read', noWithdrawal: true, ts: '1' }],
      revokeExchangeKey: vi.fn(async () => ({ ok: false, error: 'revoke failed' })),
    })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/keys" onSignOut={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /revoke/i }))
    expect(await screen.findByText(/revoke failed/i)).toBeInTheDocument()
    // Key retained, precondition NOT demoted (activate title still doesn't list it as outstanding).
    expect(screen.getByText('Only — key')).toBeInTheDocument()
    const activate = screen.getByRole('button', { name: /^activate$/i })
    expect(activate.getAttribute('title') ?? '').not.toMatch(/trading api key/i)
  })

  it('restores Active on load when persisted active and all preconditions are met', async () => {
    vi.mocked(useSetupPersistence).mockReturnValue({
      ...baseSetupPersistence,
      appropriatenessSigned: true, selectedStrategy: 'Obsidian Core Yield', savedRiskLimits: DEFAULT_RISK_LIMITS,
      activeKeys: [ACTIVE_KEY], persistedActive: true,
    })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/dashboard" onSignOut={() => {}} />)
    // ActivationControl renders a "Deactivate" control only while active.
    expect(await screen.findByRole('button', { name: /deactivate/i })).toBeInTheDocument()
  })

  it('stays Inactive on load when persisted active but a precondition is missing (guard)', async () => {
    vi.mocked(useSetupPersistence).mockReturnValue({
      ...baseSetupPersistence,
      appropriatenessSigned: true, selectedStrategy: 'Obsidian Core Yield', savedRiskLimits: DEFAULT_RISK_LIMITS,
      activeKeys: [], persistedActive: true, // no trading key → gate not open
    })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/dashboard" onSignOut={() => {}} />)
    expect(screen.queryByRole('button', { name: /deactivate/i })).toBeNull()
    expect(screen.getByRole('button', { name: /^activate$/i })).toBeInTheDocument()
  })

  it('shows an error banner and does not activate when the save fails', async () => {
    vi.mocked(useSetupPersistence).mockReturnValue({
      ...baseSetupPersistence,
      appropriatenessSigned: true, selectedStrategy: 'Obsidian Core Yield', savedRiskLimits: DEFAULT_RISK_LIMITS,
      activeKeys: [ACTIVE_KEY], persistedActive: false,
      saveActivation: vi.fn(async () => ({ ok: false, error: 'activation save failed' })),
    })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/dashboard" onSignOut={() => {}} />)
    // Gate is open (all four preconditions persisted), so Activate is enabled.
    await userEvent.click(await screen.findByRole('button', { name: /^activate$/i }))
    expect(await screen.findByText(/activation save failed/i)).toBeInTheDocument()
    // Still inactive — no Deactivate control appeared.
    expect(screen.queryByRole('button', { name: /deactivate/i })).toBeNull()
  })

  it('restores the Updates page to Installed when the pending version is persisted', async () => {
    vi.mocked(useSetupPersistence).mockReturnValue({ ...baseSetupPersistence, approvedVersions: ['v2.4.1'] })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/updates" onSignOut={() => {}} />)
    expect(await screen.findByRole('button', { name: /installed/i })).toBeInTheDocument()
  })

  it('shows an error banner and leaves the update pending when the approval save fails', async () => {
    vi.mocked(useSetupPersistence).mockReturnValue({ ...baseSetupPersistence, saveUpdateApproval: vi.fn(async () => ({ ok: false, error: 'update save failed' })) })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/updates" onSignOut={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: /approve & install/i }))
    expect(await screen.findByText(/update save failed/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /approve & install/i })).toBeInTheDocument()
  })

  it('renders persisted audit entries on the audit log page', async () => {
    vi.mocked(useSetupPersistence).mockReturnValue({
      ...baseSetupPersistence,
      persistedAudit: [{ id: 'a1', ts: '2026-08-01T00:00:00Z', actor: 'client', type: 'STRATEGY', detail: 'selected module "Twin Flow"' }],
    })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/audit" onSignOut={() => {}} />)
    expect(await screen.findByText(/selected module "Twin Flow"/i)).toBeInTheDocument()
  })

  it('appends a visible audit entry and persists it when the client acts', async () => {
    const saveAuditEvent = vi.fn(async () => ({ ok: true }))
    vi.mocked(useSetupPersistence).mockReturnValue({ ...baseSetupPersistence, saveAuditEvent })
    const base = { clientName: 'TwoPrime', program: 'Obsidian Core', onSignOut: () => {} }
    const { rerender } = render(<ClientPortalShell {...base} hash="#/portal/updates" />)
    await userEvent.click(await screen.findByRole('button', { name: /approve & install/i }))
    expect(saveAuditEvent).toHaveBeenCalled()
    rerender(<ClientPortalShell {...base} hash="#/portal/audit" />)
    expect(screen.getByText(/reviewed & approved v2\.4\.1/i)).toBeInTheDocument()
  })
})
