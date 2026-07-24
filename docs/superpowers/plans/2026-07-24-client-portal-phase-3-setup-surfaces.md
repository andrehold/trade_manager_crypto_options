# Client Portal — Phase 3: Setup Surfaces + Audit Log (UI + local state)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the four remaining client setup surfaces — **Appropriateness** self-assessment + attestation, **Strategy** selection, **Exchange keys**, **Updates** — plus the in-session **Audit log**. Completing appropriateness + strategy + a trading key flips the last three activation preconditions (risk limits already flip in Phase 2), so with all four met the **software can finally be activated end-to-end**, and every client action is recorded to the audit log.

**Architecture:** UI + local state, mirroring Phases 1–2 (no Supabase yet). `ClientPortalShell` (mounted across page switches) already holds `setupStatus` + `riskLimits`; this phase adds an in-session **audit event list** and handlers that (a) flip the remaining `setupStatus` preconditions and (b) append audit events. The audit log page renders that list. Design comes from the approved mockups (appropriateness questionnaire + attestation, neutral strategy list, exchange keys, updates, audit ledger). Durable Supabase persistence + a real greek engine remain deferred to a later slice.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind v4, Vitest + Testing Library, `lucide-react`.

## Global Constraints

- **The software never advises, recommends, or renders a verdict.** Appropriateness is the client's **self-assessment** — no software score/verdict; the disclaimer states the software does not evaluate suitability. Strategy modules carry **no "recommended"/"suggested"** marker. (Spec §2, §7.3–7.4.)
- **Design tokens only** — real tokens: `bg-bg-canvas`, `bg-bg-elevated`, `bg-bg-surface-1..4`, `text-text-{primary,secondary,tertiary}`, `border-border-{default,subtle}`, `text-status-{success,danger,warning,info}` (+ `/NN` opacity), `text-accent-400`/`bg-accent-500`, `type-{title-l,subhead,caption}`. **No raw zinc/slate/hex, no `bg-bg-surface-0`.**
- **Activation preconditions (all four):** appropriateness signed + strategy selected + risk limits applied + an active trading key. This phase makes the first, second, and fourth reachable from the UI.
- **Audit log is append-only** in the UI model (newest first); entries are attributed to `client` or `system` with a UTC timestamp and a type.
- **Package manager: pnpm.** Path alias `@/` → `src/`.
- **Do not change** `src/DashboardApp.tsx`, `src/App.tsx`, `src/features/auth/access.ts`, or the Phase 1/2 data/risk branches beyond what a task specifies.
- Every task is TDD. `pnpm exec tsc --noEmit` clean + full `pnpm test` green before each commit. Commit trailer ends with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Branch: `main` (per user direction).

---

## File Structure

```
src/features/clientPortal/
  audit.ts                       # Task 1 — AuditEvent/AuditType types, newEvent, SEED_AUDIT_EVENTS (pure)
  pages/
    AppropriatenessPage.tsx      # Task 2 — questionnaire + disclaimer + attestation + sign
    StrategyPage.tsx             # Task 3 — neutral module list + apply
    KeysPage.tsx                 # Task 4 — key list + add trading key
    UpdatesPage.tsx              # Task 5 — pending update review/approve + history
    AuditLogPage.tsx             # Task 6 — append-only ledger + filter chips
  ClientPortalShell.tsx          # Task 7 — audit state + handlers, render pages, flip preconditions
  __tests__/                     # co-located specs
```

---

### Task 1: Audit event model (pure)

**Files:**
- Create: `src/features/clientPortal/audit.ts`
- Test: `src/features/clientPortal/__tests__/audit.test.ts`

**Interfaces (Produces):**
- `type AuditActor = 'client' | 'system'`
- `type AuditType = 'APPROPRIATENESS' | 'STRATEGY' | 'RISK_PARAM' | 'API_KEY' | 'ACTIVATION' | 'DEACTIVATION' | 'UPDATE' | 'POSITION' | 'EXECUTION'`
- `type AuditEvent = { id: string; ts: string; actor: AuditActor; type: AuditType; detail: string }`
- `newEvent(type: AuditType, detail: string, actor?: AuditActor): AuditEvent` — `actor` defaults `'client'`; `ts` = `new Date().toISOString()`; `id` unique per call.
- `const SEED_AUDIT_EVENTS: AuditEvent[]` — a few illustrative historical entries (client + one system), newest first.

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/__tests__/audit.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { newEvent, SEED_AUDIT_EVENTS } from '../audit'

describe('newEvent', () => {
  it('builds a client event with an ISO timestamp and unique id', () => {
    const a = newEvent('STRATEGY', 'selected module "X"')
    expect(a.actor).toBe('client')
    expect(a.type).toBe('STRATEGY')
    expect(a.detail).toBe('selected module "X"')
    expect(() => new Date(a.ts).toISOString()).not.toThrow()
    const b = newEvent('API_KEY', 'added key')
    expect(a.id).not.toBe(b.id)
  })
  it('accepts a system actor', () => {
    expect(newEvent('EXECUTION', 'closed leg', 'system').actor).toBe('system')
  })
})

describe('SEED_AUDIT_EVENTS', () => {
  it('is a non-empty list of well-formed events', () => {
    expect(SEED_AUDIT_EVENTS.length).toBeGreaterThan(0)
    for (const e of SEED_AUDIT_EVENTS) {
      expect(typeof e.id).toBe('string')
      expect(typeof e.ts).toBe('string')
      expect(['client', 'system']).toContain(e.actor)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test audit`
Expected: FAIL — cannot find module `../audit`.

- [ ] **Step 3: Write the implementation**

Create `src/features/clientPortal/audit.ts`:
```ts
export type AuditActor = 'client' | 'system'

export type AuditType =
  | 'APPROPRIATENESS' | 'STRATEGY' | 'RISK_PARAM' | 'API_KEY'
  | 'ACTIVATION' | 'DEACTIVATION' | 'UPDATE' | 'POSITION' | 'EXECUTION'

export type AuditEvent = {
  id: string
  ts: string
  actor: AuditActor
  type: AuditType
  detail: string
}

let counter = 0

export function newEvent(type: AuditType, detail: string, actor: AuditActor = 'client'): AuditEvent {
  counter += 1
  return {
    id: `evt-${counter}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    actor,
    type,
    detail,
  }
}

export const SEED_AUDIT_EVENTS: AuditEvent[] = [
  { id: 'seed-5', ts: '2026-07-23T09:00:00Z', actor: 'system', type: 'EXECUTION', detail: 'closed BTC-14DEC25 iron condor per client parameters' },
  { id: 'seed-4', ts: '2026-07-23T08:18:20Z', actor: 'client', type: 'ACTIVATION', detail: 'software activated · gate: assessment ✓ keys ✓' },
  { id: 'seed-3', ts: '2026-07-23T08:16:12Z', actor: 'client', type: 'STRATEGY', detail: 'selected module "Weekend Vol (Short-Dated)"' },
  { id: 'seed-2', ts: '2026-07-23T08:15:40Z', actor: 'client', type: 'API_KEY', detail: 'added Deribit key ····9f2a1f9 · scope trade,read · no-withdraw' },
  { id: 'seed-1', ts: '2026-07-23T08:14:02Z', actor: 'client', type: 'APPROPRIATENESS', detail: 'self-assessment completed & signed · valid 12mo' },
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test audit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/audit.ts src/features/clientPortal/__tests__/audit.test.ts
git commit -m "feat(portal): add audit event model + seed entries"
```

---

### Task 2: AppropriatenessPage

**Files:**
- Create: `src/features/clientPortal/pages/AppropriatenessPage.tsx`
- Test: `src/features/clientPortal/__tests__/AppropriatenessPage.test.tsx`

**Interfaces:**
- Produces: `AppropriatenessPage(props: { signed: boolean; onSign: () => void }): JSX.Element`
  - A disclaimer stating the software does **not** evaluate/score/advise suitability.
  - Four self-assessment questions with selectable options (local state, pre-selected to illustrative answers).
  - Three attestation statements as **checkboxes** (`<input type="checkbox">`, role `checkbox`), unchecked initially.
  - A **"Sign & complete assessment"** button, disabled until all three attestations are checked; on click calls `onSign()`.
  - Header status pill: `signed` → "Completed & signed", else "Not completed".

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/__tests__/AppropriatenessPage.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppropriatenessPage } from '../pages/AppropriatenessPage'

describe('AppropriatenessPage', () => {
  it('states it is a self-assessment and gives no verdict', () => {
    render(<AppropriatenessPage signed={false} onSign={() => {}} />)
    expect(screen.getByText(/your own assessment/i)).toBeInTheDocument()
    expect(screen.getByText(/does not evaluate, score/i)).toBeInTheDocument()
  })
  it('gates Sign on all attestations and signs', async () => {
    const onSign = vi.fn()
    render(<AppropriatenessPage signed={false} onSign={onSign} />)
    const sign = screen.getByRole('button', { name: /sign & complete/i })
    expect(sign).toBeDisabled()
    for (const cb of screen.getAllByRole('checkbox')) await userEvent.click(cb)
    expect(sign).toBeEnabled()
    await userEvent.click(sign)
    expect(onSign).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test AppropriatenessPage`
Expected: FAIL — cannot find module `../pages/AppropriatenessPage`.

- [ ] **Step 3: Write the implementation**

Create `src/features/clientPortal/pages/AppropriatenessPage.tsx`:
```tsx
import React from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'

const QUESTIONS: { q: string; options: string[]; answer: number }[] = [
  { q: 'How many years have you actively traded options or comparable derivatives?', options: ['None', '< 1 year', '1–3 years', '3+ years'], answer: 3 },
  { q: 'Are you able to bear a total loss of the capital you deploy through this product?', options: ['No', 'Partially', 'Yes'], answer: 2 },
  { q: 'Do you understand how leverage, margin and short option positions can amplify losses?', options: ['No', 'Somewhat', 'Yes, fully'], answer: 2 },
  { q: 'Do you understand that this software is an execution tool and gives no investment advice?', options: ['No', 'Yes'], answer: 1 },
]

const ATTESTATIONS = [
  'I have assessed the appropriateness of this product for my own situation, based on my own answers above.',
  'I understand and accept the risk of losing the entire deployed capital.',
  'I retain sole responsibility for the investment decision and for regulatory compliance.',
]

export function AppropriatenessPage({ signed, onSign }: { signed: boolean; onSign: () => void }) {
  const [answers, setAnswers] = React.useState<number[]>(QUESTIONS.map((q) => q.answer))
  const [checked, setChecked] = React.useState<boolean[]>(ATTESTATIONS.map(() => false))
  const allAttested = checked.every(Boolean)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="type-title-l font-bold text-text-primary">Appropriateness</h1>
        {signed
          ? <span className="inline-flex items-center gap-1.5 rounded-full bg-status-success/15 px-2.5 py-1 type-caption font-semibold text-status-success"><Check className="h-3 w-3" />Completed &amp; signed</span>
          : <span className="rounded-full bg-bg-surface-2 px-2.5 py-1 type-caption text-text-tertiary">Not completed</span>}
      </div>

      <div className="rounded-2xl border border-dashed border-border-strong bg-bg-surface-1 p-4 type-caption text-text-secondary">
        <strong className="text-text-primary">This is your own assessment.</strong> The questions record <em>your</em> knowledge and circumstances. The software does not evaluate, score, or advise whether this product suits you, and produces no recommendation — the determination is yours alone.
      </div>

      <div className="rounded-2xl border border-border-default bg-bg-surface-1">
        <div className="px-5 py-2">
          {QUESTIONS.map((item, qi) => (
            <div key={qi} className="border-t border-border-default py-3.5 first:border-t-0">
              <div className="type-subhead text-text-primary">{item.q}</div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {item.options.map((opt, oi) => (
                  <button
                    key={oi} type="button"
                    onClick={() => setAnswers((a) => a.map((v, i) => (i === qi ? oi : v)))}
                    className={`rounded-lg border px-3 py-1.5 type-caption ${answers[qi] === oi ? 'border-accent-500/40 bg-accent-500/15 font-semibold text-accent-400' : 'border-border-strong bg-bg-surface-2 text-text-secondary hover:text-text-primary'}`}
                  >{opt}</button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="m-5 flex flex-col gap-3 rounded-xl border border-border-default bg-bg-surface-2 p-4">
          {ATTESTATIONS.map((text, i) => (
            <label key={i} className="flex items-start gap-2.5 type-subhead text-text-primary">
              <input
                type="checkbox" checked={checked[i]}
                onChange={() => setChecked((c) => c.map((v, j) => (j === i ? !v : v)))}
                className="mt-1 h-4 w-4 accent-accent-500"
              />
              <span>{text}</span>
            </label>
          ))}
          <div className="mt-1 flex items-center justify-between border-t border-border-default pt-3">
            <span className="font-mono type-caption text-text-tertiary">signed by R. Quandt · on completion</span>
            <Button variant="primary" size="sm" disabled={!allAttested} onClick={onSign}>Sign &amp; complete assessment</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test AppropriatenessPage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/pages/AppropriatenessPage.tsx src/features/clientPortal/__tests__/AppropriatenessPage.test.tsx
git commit -m "feat(portal): add appropriateness self-assessment page"
```

---

### Task 3: StrategyPage

**Files:**
- Create: `src/features/clientPortal/pages/StrategyPage.tsx`
- Test: `src/features/clientPortal/__tests__/StrategyPage.test.tsx`

**Interfaces:**
- Produces: `StrategyPage(props: { selected: string | null; onSelect: (name: string) => void }): JSX.Element`
  - A neutral radio list of modules (no "recommended" marker); local highlight state seeded from `selected` or the first module.
  - An **"Apply selection"** button calling `onSelect(highlightedModuleName)`.

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/__tests__/StrategyPage.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrategyPage } from '../pages/StrategyPage'

describe('StrategyPage', () => {
  it('lists modules without a recommendation and applies a selection', async () => {
    const onSelect = vi.fn()
    render(<StrategyPage selected={null} onSelect={onSelect} />)
    expect(screen.getByText('Weekend Vol (Short-Dated)')).toBeInTheDocument()
    expect(screen.queryByText(/recommended/i)).toBeNull()
    await userEvent.click(screen.getByText('Range Condor'))
    await userEvent.click(screen.getByRole('button', { name: /apply selection/i }))
    expect(onSelect).toHaveBeenCalledWith('Range Condor')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test StrategyPage`
Expected: FAIL — cannot find module `../pages/StrategyPage`.

- [ ] **Step 3: Write the implementation**

Create `src/features/clientPortal/pages/StrategyPage.tsx`:
```tsx
import React from 'react'
import { Button } from '@/components/ui/Button'

const MODULES: { name: string; desc: string; facts: string[] }[] = [
  { name: 'Weekend Vol (Short-Dated)', desc: 'Sells short-dated BTC iron condors over the weekend session.', facts: ['horizon 1–3 DTE', 'legs 4', 'venue Deribit'] },
  { name: 'Range Condor', desc: 'Defined-risk condors on a fixed weekly expiry cadence.', facts: ['horizon 7 DTE', 'legs 4', 'venue Deribit'] },
  { name: 'Delta-Neutral Straddle', desc: 'Long/short straddle rebalanced to a delta band you set.', facts: ['horizon 3–14 DTE', 'legs 2', 'venue Deribit'] },
]

export function StrategyPage({ selected, onSelect }: { selected: string | null; onSelect: (name: string) => void }) {
  const [pick, setPick] = React.useState<string>(selected ?? MODULES[0].name)
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="type-title-l font-bold text-text-primary">Strategy module</h1>
        <span className="rounded-full bg-bg-surface-2 px-2.5 py-1 type-caption text-text-tertiary">You select</span>
      </div>
      <p className="type-subhead text-text-secondary">Choose which module the software runs. Modules are presented neutrally — the software does not recommend one over another.</p>
      <div className="rounded-2xl border border-border-default bg-bg-surface-1">
        <div className="px-5 py-2">
          {MODULES.map((m) => (
            <button
              key={m.name} type="button" onClick={() => setPick(m.name)}
              className="flex w-full items-start gap-3.5 border-t border-border-default py-3.5 text-left first:border-t-0"
            >
              <span className={`mt-1 grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full border-2 ${pick === m.name ? 'border-accent-500' : 'border-text-faint'}`}>
                {pick === m.name && <span className="h-2 w-2 rounded-full bg-accent-500" />}
              </span>
              <span className="flex-1">
                <span className="block type-subhead font-semibold text-text-primary">{m.name}</span>
                <span className="block type-caption text-text-tertiary">{m.desc}</span>
                <span className="mt-1.5 flex flex-wrap gap-3 font-mono text-[11px] text-text-tertiary">{m.facts.map((f) => <span key={f}>{f}</span>)}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center border-t border-border-default px-5 py-3">
          <span className="font-mono type-caption text-text-tertiary">client-set · not advised by the software</span>
          <div className="ml-auto"><Button variant="primary" size="sm" onClick={() => onSelect(pick)}>Apply selection</Button></div>
        </div>
      </div>
    </div>
  )
}
```
> Note: `h-4.5`/`w-4.5` are valid Tailwind v4 arbitrary-free fractional utilities; if the toolchain rejects them, use `h-[18px] w-[18px]`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test StrategyPage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/pages/StrategyPage.tsx src/features/clientPortal/__tests__/StrategyPage.test.tsx
git commit -m "feat(portal): add strategy module selection page"
```

---

### Task 4: KeysPage

**Files:**
- Create: `src/features/clientPortal/pages/KeysPage.tsx`
- Test: `src/features/clientPortal/__tests__/KeysPage.test.tsx`

**Interfaces:**
- Produces: `KeysPage(props: { hasActiveKey: boolean; onAddKey: (label: string) => void }): JSX.Element`
  - Header status pill: `hasActiveKey` → "1 active", else "No trading key".
  - An **"Add key"** button calling `onAddKey('Deribit — main')`.
  - An illustrative existing read-only backup key row + a note that the software never holds withdrawal permission. When `hasActiveKey`, also show the active Deribit trading key row.

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/__tests__/KeysPage.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KeysPage } from '../pages/KeysPage'

describe('KeysPage', () => {
  it('adds a trading key and states no-withdrawal', async () => {
    const onAddKey = vi.fn()
    render(<KeysPage hasActiveKey={false} onAddKey={onAddKey} />)
    expect(screen.getByText(/never holds withdrawal/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /add key/i }))
    expect(onAddKey).toHaveBeenCalledWith('Deribit — main')
  })
  it('shows the active key when present', () => {
    render(<KeysPage hasActiveKey onAddKey={() => {}} />)
    expect(screen.getByText(/1 active/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test KeysPage`
Expected: FAIL — cannot find module `../pages/KeysPage`.

- [ ] **Step 3: Write the implementation**

Create `src/features/clientPortal/pages/KeysPage.tsx`:
```tsx
import { Plus, Info } from 'lucide-react'
import { Button } from '@/components/ui/Button'

function Scope({ children, deny }: { children: React.ReactNode; deny?: boolean }) {
  return <span className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] ${deny ? 'bg-status-danger/15 text-status-danger' : 'bg-status-success/15 text-status-success'}`}>{children}</span>
}

function KeyRow({ venue, name, fp, scopes }: { venue: string; name: string; fp: string; scopes: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3.5 border-t border-border-default py-3.5 first:border-t-0">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-bg-surface-3 font-mono text-[11px] font-bold text-text-secondary">{venue}</div>
      <div className="min-w-0 flex-1">
        <div className="type-subhead font-semibold text-text-primary">{name}</div>
        <div className="font-mono type-caption text-text-tertiary">{fp}</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">{scopes}</div>
      </div>
    </div>
  )
}

export function KeysPage({ hasActiveKey, onAddKey }: { hasActiveKey: boolean; onAddKey: (label: string) => void }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="type-title-l font-bold text-text-primary">Exchange API keys</h1>
        <span className={`rounded-full px-2.5 py-1 type-caption font-semibold ${hasActiveKey ? 'bg-status-success/15 text-status-success' : 'bg-bg-surface-2 text-text-tertiary'}`}>{hasActiveKey ? '1 active' : 'No trading key'}</span>
        <div className="ml-auto"><Button variant="secondary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => onAddKey('Deribit — main')}>Add key</Button></div>
      </div>
      <p className="type-subhead text-text-secondary">You create these keys on the venue and control them here. The software never holds withdrawal permission and cannot move funds.</p>
      <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-5">
        {hasActiveKey && (
          <KeyRow venue="DBT" name="Deribit — main" fp="key ····9f2a1f9 · added just now" scopes={<><Scope>trade</Scope><Scope>read</Scope><Scope deny>no withdrawal</Scope></>} />
        )}
        <KeyRow venue="DBT" name="Deribit — read-only backup" fp="key ····3b70c4e · added 2026-06-01" scopes={<><Scope>read</Scope><Scope deny>no trade</Scope><Scope deny>no withdrawal</Scope></>} />
        <div className="mt-3.5 flex items-start gap-2 type-caption text-text-tertiary">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-faint" />
          Keys are generated by you on the venue and stored encrypted. Revoking a key here and on the venue immediately halts all execution.
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test KeysPage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/pages/KeysPage.tsx src/features/clientPortal/__tests__/KeysPage.test.tsx
git commit -m "feat(portal): add exchange API keys page"
```

---

### Task 5: UpdatesPage

**Files:**
- Create: `src/features/clientPortal/pages/UpdatesPage.tsx`
- Test: `src/features/clientPortal/__tests__/UpdatesPage.test.tsx`

**Interfaces:**
- Produces: `UpdatesPage(props: { onApprove: (ver: string) => void }): JSX.Element`
  - A pending-update card (v2.4.1) with a changelog and an **"Approve & install"** button calling `onApprove('v2.4.1')`; once approved (local state), the card shows an installed state and the button is disabled.
  - A version-history list ("approved by R. Quandt").

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/__tests__/UpdatesPage.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UpdatesPage } from '../pages/UpdatesPage'

describe('UpdatesPage', () => {
  it('approves the pending update', async () => {
    const onApprove = vi.fn()
    render(<UpdatesPage onApprove={onApprove} />)
    await userEvent.click(screen.getByRole('button', { name: /approve & install/i }))
    expect(onApprove).toHaveBeenCalledWith('v2.4.1')
    expect(screen.getByText(/installed/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test UpdatesPage`
Expected: FAIL — cannot find module `../pages/UpdatesPage`.

- [ ] **Step 3: Write the implementation**

Create `src/features/clientPortal/pages/UpdatesPage.tsx`:
```tsx
import React from 'react'
import { Download, Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'

const CHANGELOG = [
  'Deribit reconnection hardening after venue maintenance windows',
  'Drawdown-stop evaluation moved to per-tick (was per-minute)',
  'Audit-log export now includes cryptographic chain hash',
]
const HISTORY = [
  { ver: 'v2.4.0', date: '2026-07-11', note: 'Portfolio-greeks aggregation fix' },
  { ver: 'v2.3.5', date: '2026-06-28', note: 'CoinCall venue adapter' },
]

export function UpdatesPage({ onApprove }: { onApprove: (ver: string) => void }) {
  const [installed, setInstalled] = React.useState(false)
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="type-title-l font-bold text-text-primary">Software updates</h1>
        <span className="rounded-full bg-bg-surface-2 px-2.5 py-1 font-mono type-caption text-text-tertiary">current v2.4.0</span>
        {!installed && <span className="rounded-full bg-status-warning/15 px-2.5 py-1 type-caption font-semibold text-status-warning">1 pending your approval</span>}
      </div>
      <p className="type-subhead text-text-secondary">Updates install only after you review and approve them. Nothing is applied automatically.</p>
      <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-5">
        <div className={`flex flex-wrap gap-3.5 rounded-xl border p-4 ${installed ? 'border-status-success/30 bg-status-success/10' : 'border-status-warning/30 bg-status-warning/10'}`}>
          <span className={installed ? 'text-status-success' : 'text-status-warning'}>{installed ? <Check className="h-5 w-5" /> : <Download className="h-5 w-5" />}</span>
          <div className="min-w-0 flex-1">
            <div className="type-subhead font-semibold text-text-primary">Update {installed ? 'installed' : 'available'} — <span className="font-mono text-status-warning">v2.4.1</span></div>
            <ul className="mt-2 list-disc pl-4 type-caption text-text-secondary">{CHANGELOG.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
          <div className="self-center">
            <Button variant="primary" size="sm" disabled={installed} onClick={() => { setInstalled(true); onApprove('v2.4.1') }}>{installed ? 'Installed' : 'Approve & install'}</Button>
          </div>
        </div>
        <div className="mt-4">
          {HISTORY.map((h) => (
            <div key={h.ver} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-default py-2.5 type-caption">
              <span className="w-16 font-mono font-semibold text-text-secondary">{h.ver}</span>
              <span className="font-mono text-text-tertiary">{h.date}</span>
              <span className="text-text-secondary">{h.note}</span>
              <span className="ml-auto text-text-tertiary">approved by <b className="text-text-secondary">R. Quandt</b></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test UpdatesPage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/pages/UpdatesPage.tsx src/features/clientPortal/__tests__/UpdatesPage.test.tsx
git commit -m "feat(portal): add software updates page"
```

---

### Task 6: AuditLogPage

**Files:**
- Create: `src/features/clientPortal/pages/AuditLogPage.tsx`
- Test: `src/features/clientPortal/__tests__/AuditLogPage.test.tsx`

**Interfaces:**
- Consumes: `AuditEvent`, `AuditType` from `../audit`.
- Produces: `AuditLogPage(props: { events: AuditEvent[] }): JSX.Element`
  - A filter chip row: `all` · `client actions` · `activation` · `parameters` · `keys` · `positions` · `updates` (local active-filter state; `all` default).
  - An append-only ledger (timestamp · actor · type · detail), newest first, filtered by the active chip. Client vs system actor visually distinguished. Empty state when the filter matches nothing.

Filter → types mapping: `client actions`→any actor==='client'; `activation`→ACTIVATION/DEACTIVATION; `parameters`→RISK_PARAM; `keys`→API_KEY; `positions`→POSITION; `updates`→UPDATE.

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/__tests__/AuditLogPage.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuditLogPage } from '../pages/AuditLogPage'
import type { AuditEvent } from '../audit'

const events: AuditEvent[] = [
  { id: '1', ts: '2026-07-23T08:18:20Z', actor: 'client', type: 'ACTIVATION', detail: 'software activated' },
  { id: '2', ts: '2026-07-23T09:00:00Z', actor: 'system', type: 'EXECUTION', detail: 'closed a leg' },
]

describe('AuditLogPage', () => {
  it('renders entries and filters by type', async () => {
    render(<AuditLogPage events={events} />)
    expect(screen.getByText('software activated')).toBeInTheDocument()
    expect(screen.getByText('closed a leg')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^activation$/i }))
    expect(screen.getByText('software activated')).toBeInTheDocument()
    expect(screen.queryByText('closed a leg')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test AuditLogPage`
Expected: FAIL — cannot find module `../pages/AuditLogPage`.

- [ ] **Step 3: Write the implementation**

Create `src/features/clientPortal/pages/AuditLogPage.tsx`:
```tsx
import React from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { AuditEvent, AuditType } from '../audit'

type Filter = 'all' | 'client actions' | 'activation' | 'parameters' | 'keys' | 'positions' | 'updates'
const FILTERS: Filter[] = ['all', 'client actions', 'activation', 'parameters', 'keys', 'positions', 'updates']

const TYPES_FOR: Partial<Record<Filter, AuditType[]>> = {
  activation: ['ACTIVATION', 'DEACTIVATION'],
  parameters: ['RISK_PARAM'],
  keys: ['API_KEY'],
  positions: ['POSITION'],
  updates: ['UPDATE'],
}

const TYPE_COLOR: Partial<Record<AuditType, string>> = {
  APPROPRIATENESS: 'text-status-success', ACTIVATION: 'text-status-success', DEACTIVATION: 'text-status-danger',
  API_KEY: 'text-status-info', STRATEGY: 'text-accent-400', RISK_PARAM: 'text-accent-400',
  UPDATE: 'text-status-warning', POSITION: 'text-status-danger', EXECUTION: 'text-text-tertiary',
}

function matches(e: AuditEvent, f: Filter): boolean {
  if (f === 'all') return true
  if (f === 'client actions') return e.actor === 'client'
  return (TYPES_FOR[f] ?? []).includes(e.type)
}

export function AuditLogPage({ events }: { events: AuditEvent[] }) {
  const [filter, setFilter] = React.useState<Filter>('all')
  const shown = events.filter((e) => matches(e, filter))
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="type-title-l font-bold text-text-primary">Audit log</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-status-info/15 px-2.5 py-1 type-caption font-semibold text-status-info">append-only · tamper-evident</span>
        <div className="ml-auto"><Button variant="secondary" size="sm" leftIcon={<Download className="h-3.5 w-3.5" />}>Export signed CSV</Button></div>
      </div>
      <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-5">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f} type="button" onClick={() => setFilter(f)}
              className={`rounded-lg border px-2.5 py-1 font-mono text-[11.5px] ${filter === f ? 'border-accent-500/40 bg-accent-500/15 text-accent-400' : 'border-border-default bg-bg-surface-2 text-text-tertiary hover:text-text-secondary'}`}
            >{f}</button>
          ))}
        </div>
        <div className="mt-3.5 overflow-x-auto rounded-xl border border-border-default">
          <div className="grid grid-cols-[176px_110px_128px_1fr] gap-3.5 border-b border-border-default bg-bg-surface-2 px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-text-tertiary" style={{ minWidth: 640 }}>
            <span>timestamp (utc)</span><span>actor</span><span>type</span><span>detail</span>
          </div>
          {shown.length === 0
            ? <div className="px-4 py-6 text-center type-caption text-text-tertiary">No entries for this filter.</div>
            : shown.map((e) => (
              <div key={e.id} className="grid grid-cols-[176px_110px_128px_1fr] gap-3.5 border-t border-border-default px-4 py-2.5 font-mono text-xs first:border-t-0" style={{ minWidth: 640 }}>
                <span className="text-text-tertiary">{e.ts.replace('T', ' ').replace(/\.\d+Z$/, 'Z')}</span>
                <span className={e.actor === 'system' ? 'text-text-faint' : 'text-text-secondary'}>{e.actor === 'system' ? 'system' : 'R.Quandt'}</span>
                <span className={`font-semibold ${TYPE_COLOR[e.type] ?? 'text-text-secondary'}`}>{e.type}</span>
                <span className="truncate text-text-secondary">{e.detail}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test AuditLogPage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/pages/AuditLogPage.tsx src/features/clientPortal/__tests__/AuditLogPage.test.tsx
git commit -m "feat(portal): add append-only audit log page"
```

---

### Task 7: Wire setup surfaces + audit into the shell

**Files:**
- Modify: `src/features/clientPortal/ClientPortalShell.tsx`
- Modify: `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`

**Interfaces:**
- Consumes: the five pages from `./pages/*`; `newEvent`, `SEED_AUDIT_EVENTS`, `type AuditEvent`, `type AuditType` from `./audit`.
- Behavior: shell adds `auditEvents` state (seeded) + `strategy` state + an `appendAudit(type, detail, actor?)` helper. Handlers: `signAppropriateness`, `selectStrategy`, `addTradingKey`, `approveUpdate` each flip the relevant `setupStatus` precondition (except updates, which isn't a precondition) and append an audit event; `applyRiskLimits` also appends `RISK_PARAM`; activation toggle appends `ACTIVATION`/`DEACTIVATION`; position modify/close append `POSITION`. The content branch renders the five new pages; the Phase 1/2 branches are unchanged.

- [ ] **Step 1: Write the failing test additions**

In `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`, keep all existing tests and add (reuse the file's existing `userEvent` import and `mockedHook` setup):
```tsx
it('renders the audit log with seed entries', () => {
  render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/audit" onSignOut={() => {}} />)
  expect(screen.getByRole('heading', { name: /audit log/i })).toBeInTheDocument()
  expect(screen.getByText(/self-assessment completed & signed/i)).toBeInTheDocument()
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
  rerender(<ClientPortalShell {...base} hash="#/portal/risk" />)
  await userEvent.click(screen.getAllByRole('button', { name: /apply deployment/i })[0])
  expect(screen.getByRole('button', { name: /^activate$/i })).toBeEnabled()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test ClientPortalShell`
Expected: FAIL — audit heading/entries not rendered (still placeholder), and the activate flow can't complete.

- [ ] **Step 3: Update the shell**

In `src/features/clientPortal/ClientPortalShell.tsx`:
1. Add imports after the existing page imports:
```tsx
import { AppropriatenessPage } from './pages/AppropriatenessPage'
import { StrategyPage } from './pages/StrategyPage'
import { KeysPage } from './pages/KeysPage'
import { UpdatesPage } from './pages/UpdatesPage'
import { AuditLogPage } from './pages/AuditLogPage'
import { newEvent, SEED_AUDIT_EVENTS, type AuditEvent, type AuditType } from './audit'
```
2. Add state + handlers right after the existing `applyRiskLimits` definition, and replace `applyRiskLimits` so it also appends an audit event:
```tsx
  const [auditEvents, setAuditEvents] = React.useState<AuditEvent[]>(SEED_AUDIT_EVENTS)
  const [strategy, setStrategy] = React.useState<string | null>(null)
  const appendAudit = React.useCallback((type: AuditType, detail: string, actor: 'client' | 'system' = 'client') => {
    setAuditEvents((evs) => [newEvent(type, detail, actor), ...evs])
  }, [])
  const applyRisk = React.useCallback((next: RiskLimits) => {
    setRiskLimits(next)
    setSetupStatus((s) => ({ ...s, riskLimits: true }))
    appendAudit('RISK_PARAM', 'risk & greek limits applied')
  }, [appendAudit])
  const signAppropriateness = React.useCallback(() => {
    setSetupStatus((s) => ({ ...s, appropriateness: true }))
    appendAudit('APPROPRIATENESS', 'self-assessment completed & signed')
  }, [appendAudit])
  const selectStrategy = React.useCallback((name: string) => {
    setStrategy(name)
    setSetupStatus((s) => ({ ...s, strategy: true }))
    appendAudit('STRATEGY', `selected module "${name}"`)
  }, [appendAudit])
  const addTradingKey = React.useCallback((label: string) => {
    setSetupStatus((s) => ({ ...s, tradingKey: true }))
    appendAudit('API_KEY', `added ${label} · scope trade,read · no-withdraw`)
  }, [appendAudit])
  const approveUpdate = React.useCallback((ver: string) => {
    appendAudit('UPDATE', `reviewed & approved ${ver} → installed`)
  }, [appendAudit])
  const toggleActivation = React.useCallback(() => {
    setActive((a) => {
      const next = !a
      appendAudit(next ? 'ACTIVATION' : 'DEACTIVATION', next ? 'software activated' : 'software deactivated')
      return next
    })
  }, [appendAudit])
```
   Then **delete the old `applyRiskLimits` const** (lines 29–32) — it's replaced by `applyRisk` above. (Everything below that referenced `applyRiskLimits` will be updated in step 4/5.)
3. Change the `ActivationControl`'s `onToggle` to use the new handler:
```tsx
          <ActivationControl active={active} setupStatus={setupStatus} onToggle={toggleActivation} />
```
4. Replace the content-branch conditional so the five new pages render and the risk page uses `applyRisk`:
```tsx
          {page === 'risk' ? (
            <RiskPage limits={riskLimits} onApply={applyRisk} />
          ) : page === 'appropriateness' ? (
            <AppropriatenessPage signed={setupStatus.appropriateness} onSign={signAppropriateness} />
          ) : page === 'strategy' ? (
            <StrategyPage selected={strategy} onSelect={selectStrategy} />
          ) : page === 'keys' ? (
            <KeysPage hasActiveKey={setupStatus.tradingKey} onAddKey={addTradingKey} />
          ) : page === 'updates' ? (
            <UpdatesPage onApprove={approveUpdate} />
          ) : page === 'audit' ? (
            <AuditLogPage events={auditEvents} />
          ) : (page === 'dashboard' || page === 'positions') ? (
            error ? (
              <div className="rounded-2xl border border-status-danger/30 bg-status-danger/10 p-6 text-center">
                <p className="type-subhead text-status-danger">Could not load your positions.</p>
                <p className="mt-1 type-caption text-text-secondary">{error}</p>
                <div className="mt-4"><Button variant="secondary" size="sm" onClick={reload}>Retry</Button></div>
              </div>
            ) : loading ? (
              <div className="grid place-items-center py-20"><Spinner className="h-6 w-6" /></div>
            ) : page === 'positions' ? (
              <PositionsPage positions={positions} onModify={(id) => appendAudit('POSITION', `modify requested · ${id}`)} onClose={(id) => appendAudit('POSITION', `manual close · ${id} · client override`)} />
            ) : (
              <DashboardPage positions={positions} setupStatus={setupStatus} onNavigate={navigate} />
            )
          ) : (
            <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-8 text-center type-subhead text-text-secondary">
              {PAGE_TITLES[page]} — coming in a later phase.
            </div>
          )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test ClientPortalShell`
Expected: PASS — the prior tests plus the two new ones (audit seed render, activate-after-all-four).

- [ ] **Step 5: Full typecheck, test, build**

Run: `pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: no type errors; all tests pass; build succeeds.

- [ ] **Step 6: Manual verification in the preview**

Start the dev server, sign in as the client. Walk: **Appropriateness** → check the three attestations → Sign (sidebar check goes green). **Strategy** → Apply selection (check). **Exchange keys** → Add key (check). **Risk & deployment** → Apply (check). Now the top-bar **Activate** button is enabled — click it (state → Active). Open **Audit log** — confirm entries for each action appear newest-first, and the filter chips work.

- [ ] **Step 7: Commit**

```bash
git add src/features/clientPortal/ClientPortalShell.tsx src/features/clientPortal/__tests__/ClientPortalShell.test.tsx
git commit -m "feat(portal): wire setup surfaces + audit log into shell; enable end-to-end activation"
```

---

## Self-Review

**Spec coverage (spec §7.3–7.8, the 10 client capabilities):**
- Appropriateness self-assessment (client assesses, software gives no verdict) → Task 2. ✓
- Strategy selection (neutral, no recommendation) → Task 3. ✓
- Exchange keys (client-controlled, no withdrawal) → Task 4. ✓
- Approves & installs updates → Task 5. ✓
- Keeps complete audit logs (append-only, actor-attributed) → Tasks 1 + 6, fed by Task 7. ✓
- Activates/deactivates the software (all four preconditions reachable) → Task 7 (activation enables after appropriateness + strategy + risk + key). ✓
- Every client action recorded → Task 7 handlers append audit events. ✓

**Deferred (correctly out of this slice):** Supabase persistence of assessments/selection/keys/updates/audit; real audit durability + tamper-evidence chain; real update package delivery; real key-secret handling; greek-engine live values. Tracked for the next slice.

**Placeholder scan:** No "TBD"/vague steps — every code step is complete. The one flagged toolchain risk (`h-4.5`/`w-4.5` in StrategyPage) has an explicit fallback note.

**Type consistency:** `AuditEvent`, `AuditActor`, `AuditType`, `newEvent`, `SEED_AUDIT_EVENTS`, and the five page component prop signatures are defined once and consumed by Task 7 with matching shapes. The shell test's button-name/role expectations (`sign & complete`, `apply selection`, `add key`, `apply deployment`, `activate`, `checkbox`) match the labels/controls each page task defines.

**No-advice check:** appropriateness disclaimer ("does not evaluate, score, or advise"), strategy "does not recommend one over another" + no "recommended" marker, key/update/audit copy all descriptive. No verdict/recommendation anywhere.

**Design tokens:** all classes use real tokens; no `bg-bg-surface-0`. Grid `minWidth` inline styles on the ledger are numeric layout values, not colors.
