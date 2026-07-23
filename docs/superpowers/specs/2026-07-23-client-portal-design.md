# Client Portal — Regulatory-Conform Redesign

**Date:** 2026-07-23
**Status:** Design approved (mockup) → ready for implementation planning
**Mockup:** Artifact "Client Portal — Role-Gated Redesign"
**Target area:** `src/features/clientDashboard/` (expands into `src/features/clientPortal/`)

---

## 1. Context & goal

Bring the client-facing front end into regulatory conformance. The regulatory posture is that
**the client is the sole decision-maker and operator**, and the software is a **tool** that
executes the client's parameters and keeps a complete record. The client:

- assesses whether the product is appropriate
- selects the strategy module
- sets all risk and deployment parameters
- creates and controls the exchange API keys
- activates and deactivates the software
- approves and installs updates
- monitors trades and risks
- can override, modify or close every position
- retains responsibility for regulatory compliance and investment decisions
- keeps complete audit logs

The current `ClientDashboardPage` covers only monitoring and partial position control. This redesign
surfaces every capability above, each attributed to the client and recorded in an audit log.

## 2. Core principle (non-negotiable)

> **The software records the client's own decisions. It never advises, recommends, or renders a verdict.**

Concretely, this bans throughout the UI and copy:
- any "recommended" / "suggested" tag on strategy modules or parameters
- any software-issued appropriateness verdict ("you are appropriate")
- any language implying the software makes an investment decision

Appropriateness is a **client self-assessment** — the software captures and timestamps the client's own
answers and declaration, and explicitly disclaims evaluating or scoring them.

## 3. Architecture overview

Two role-gated experiences behind a shared identity provider (Supabase):

| Portal | Who | What | Code |
|---|---|---|---|
| **Admin desk** | operator (us) | full control over everything and all clients | existing `DashboardApp` — unchanged |
| **Client portal** | account holder | restricted app-shell; the 10 capabilities above | **new** `src/features/clientPortal/` |

Role is already resolvable: `resolveClientAccess(user)` in `src/features/auth/access.ts` returns
`{ isAdmin, clientName, clientId }` (admin via `app_metadata.role === 'admin'` or the email allowlist).
The redesign **routes on this**: admins land in `DashboardApp`; clients land in the client portal shell.

### 3.1 Two front doors + dev switch

- **Production:** two separate entry URLs — e.g. `app.<host>/login` (client) and `admin.<host>/login`
  (admin), or two hash routes `#/login` and `#/admin`. Each door is its own branded login screen
  (client = violet, admin = amber). The URL is the role choice; there is no in-page role selector.
- **Auth still authoritative:** the door is a UX convenience. `resolveClientAccess` remains the source of
  truth — a client hitting the admin door still gets the client portal, and vice-versa. The door only
  pre-selects branding and the post-login destination.
- **Dev-only switch:** a `import.meta.env.DEV`-gated floating control to flip between the two doors
  instantly during testing. Never shipped to production.

## 4. Routing

Extend the existing `parseHash` pattern in `src/App.tsx`. Client portal pages are sub-routes:

```
#/login                     client login (default door)
#/admin                     admin login door
#/portal                    → redirect to #/portal/dashboard
#/portal/dashboard          Dashboard (monitoring overview)
#/portal/positions          Positions (monitor + override/modify/close)
#/portal/appropriateness    Appropriateness self-assessment
#/portal/strategy           Strategy module selection
#/portal/risk               Risk & deployment (greeks, stress, deployment)
#/portal/keys               Exchange API keys
#/portal/updates            Software updates
#/portal/audit              Audit log
```

Admin routes (`#/client-dashboard`, `#/playbooks`, …) are unchanged. A top-level router decides
admin-shell vs client-shell from `resolveClientAccess`.

## 5. Client portal information architecture

Left sidebar, **grouped, dashboard-first**:

```
[client identity — name · program · exchange]

  Dashboard            (monitoring overview, landing)
  Positions            (detailed table + override controls)

  SETUP & CONTROLS
  Appropriateness      ✓ (setup status glyph)
  Strategy module      ✓
  Risk & deployment    ✓
  Exchange keys        ✓
  Updates              • (amber = pending approval)

  RECORD
  Audit log

[user · role · sign out]
```

- Sidebar nav items carry a **setup-status glyph** (green check = complete, amber dot = attention) so the
  client sees outstanding items without opening each page.
- No numbered steps — clients return and jump around; each page shows a **status pill** in its header instead.
- Mobile: sidebar becomes an off-canvas drawer behind a menu button + backdrop.

## 6. Persistent chrome (every client page)

- **Top bar:** page title · portfolio greeks (Δ Γ V Θ) · **master Activation control**. The activation
  control shows current state (Active / Inactive) and an always-reachable **kill-switch (Deactivate)** —
  persistent because a kill switch must be one click away from anywhere.
- **Responsibility strip:** non-dismissible band stating the client retains compliance and
  investment-decision responsibility and that the software gives no advice. Links to the audit log.

## 7. Pages

### 7.1 Dashboard (`#/portal/dashboard`)
Monitoring overview. Portfolio KPIs (Equity, PnL, PnL %, open positions), a **setup-status** strip
(each capability's state), and an open-positions preview linking to Positions. Reuses aggregation logic
already in `ClientDashboardPage` (`positionUnrealizedPnL`, `positionGreeks`).

### 7.2 Positions (`#/portal/positions`)
Monitor trades & risk + **override any position**. Tabs: Positions / Trades / Open for Confirmation
(reuse `TransactionTable`, `ConfirmationTable`, `DataTable`). Each position row carries **Modify** and
**Close** controls (client override), plus **Stop** on confirmations. Every override writes to the audit log.

### 7.3 Appropriateness (`#/portal/appropriateness`)
Client self-assessment. A short questionnaire (experience, loss-bearing capacity, leverage understanding,
tool-not-advice acknowledgment), an explicit **disclaimer** that the software does not score or advise, and
a signed **attestation** block (checkboxes + signature + timestamp + IP). Status pill: *Completed & signed ·
valid until <date>* or *Not completed*. Completion + signature is a precondition of activation (§9).

### 7.4 Strategy module (`#/portal/strategy`)
Client selects the module from a neutral list (name, factual descriptor, horizon/legs/venue facts). **No
recommendation markers.** "Apply selection" writes selection + timestamp to the audit log.

### 7.5 Risk & deployment (`#/portal/risk`) — see §8
### 7.6 Exchange keys (`#/portal/keys`)
Client-owned key management: add / rotate / revoke, per-venue, with **scopes** shown (`trade`, `read`,
`no withdrawal`). Copy makes explicit the client generates keys on the venue and the software never holds
withdrawal permission and cannot move funds. Revoking halts execution. Only **key metadata** is stored
(fingerprint, scopes, timestamps) — never the secret in plaintext in the app; secrets go to the encrypted
store / venue. (Entering the secret itself is a client action; the app must not display it back.)

### 7.7 Updates (`#/portal/updates`)
Pending update card requiring **Review → Approve & install** (nothing auto-installs), plus version history
with "approved by <client>". Sidebar shows an amber dot while an update is pending.

### 7.8 Audit log (`#/portal/audit`)
Complete, **append-only, tamper-evident** ledger. Columns: timestamp (UTC) · actor · type · detail.
Distinguishes **client actions** from **system executions**. Filterable by type; **export signed CSV** with
a cryptographic chain hash. Entry types: APPROPRIATENESS, STRATEGY, RISK_PARAM, GREEK_LIMIT, API_KEY,
ACTIVATION/DEACTIVATION, UPDATE, POSITION (override), EXECUTION (system).

## 8. Risk & deployment engine (the novel surface)

All Greek, stress and delta limits are expressed as **% of strategy TVL**.

> **TVL — Total Value Locked.** The capital the client allocated to this strategy. All limits are a
> percentage of it, so limits scale automatically when the allocation changes.

Three cards:

**A. Deployment** — capital allocation (TVL), max concurrent structures, expiry window, auto-roll toggle.

**B. Greek exposure limits** — each row shows the client-set bound, a live value, and a band gauge:

| Limit | Bound | Notes |
|---|---|---|
| Delta Cash | `−60% < Δ% < +60%` when `Γ>0`; `−10% < Δ% < +10%` when `Γ<0` | **regime-dependent** on gamma sign; active band highlighted, gauge tracks active band |
| Gamma Cash (per 1% move) | `−10% < Γ% < 0%` | two-sided; upper bound **default 0** but editable (keeps interface general, not premium-only) |
| Vega Cash (per 1% IV) | `−0.5% < V% < +0.5%` | symmetric band |
| Theta Cash | `−2% < Θ%` | floor only |

**C. Stress & aggregate limits:**
- **Stress loss ≤ 5% TVL** — defined as the worst loss over a **±10% spot × ±20% parallel IV** shock grid.
  UI renders the 3×3 scenario matrix with the worst cell highlighted + headroom readout.
- **Net delta |Δ| ≤ 10% TVL** — absolute aggregate delta cap.
- **Drawdown stop (two-stage)** — see §8.1.

### 8.1 Breach behavior (differs by limit type)

- **Greek, stress & net-delta limits → auto-rebalance.** On breach the software **adjusts positions to
  revert within range** — it does not close out. Shown as an "on breach → rebalance" indicator.
- **Drawdown stop → two-stage traffic light.** Amber **"reduce risk"** threshold (software trims positions),
  then red **"stop & close all positions"** threshold (halts trading, closes everything, records event;
  re-activation requires the client's action). Rendered as a green→amber→red gauge with two threshold ticks.

### 8.2 Limit defaults

Bounds are **client-set fields** pre-filled from a **per-strategy defaults template** (a config object,
not hard-coded UI). Editing a bound writes a `GREEK_LIMIT` / `RISK_PARAM` audit entry. Defaults can be
changed later without UI changes. Illustrative live values in the mockup are placeholders.

## 9. Activation gating

The master activation control can move to **Active** only when the client has:
1. completed & signed the appropriateness self-assessment,
2. selected a strategy module,
3. applied risk & deployment limits, and
4. added at least one **active trading-scoped** API key.

Until then the control is disabled with a hint listing what's outstanding (mirrors the sidebar glyphs).
Activation and each deactivation write to the audit log with the gate state. **Decided: all four
preconditions are required.**

## 10. Data model (Supabase)

New tables (names indicative), all scoped by `client_id`:

- `appropriateness_assessments` — answers (jsonb), signature, signed_at, valid_until, ip.
- `strategy_selections` — module_id, selected_at, selected_by.
- `risk_limits` — one row per client/strategy: deployment params + greek bounds + stress/net-delta/drawdown
  thresholds (jsonb), updated_at, updated_by.
- `exchange_keys` — venue, label, fingerprint, scopes, status, added_at, last_used_at. **No secret.**
- `software_activation` — state (active/inactive), changed_at, changed_by, gate_snapshot.
- `software_updates` — version, changelog, status (pending/approved/installed), approved_by, approved_at.
- `audit_log` — append-only: ts, client_id, actor (client|system), type, detail (jsonb), prev_hash, hash.

Audit log is the spine: every write in the tables above also appends an audit entry. RLS restricts each
client to their own rows; the audit log is insert-only (no update/delete) for tamper-evidence.

## 11. Components & reuse

Design language = existing dark dashboard tokens (`bg-surface-*`, `text-*`, `border-*`, accent violet,
emerald/rose semantics, mono for machine/ledger data). **No raw zinc/slate/hex** in components.

Reuse from `src/components/ui`: `Button`, `IconButton`, `Card`, `Input`, `SegmentedControl`, `DataTable`,
`Modal`, `Sheet` (mobile sidebar), `Tooltip`, `Badge`/`StatusBadge`, `Chip`, `PageHeader`, `EmptyState`.
Reuse existing `TransactionTable`, `ConfirmationTable`, `StatusBadge`, and the portfolio aggregation helpers.

New components (client portal):
- `ClientPortalShell` (sidebar + top bar + responsibility strip + routed content)
- `ClientSidebar` (grouped nav + setup-status glyphs)
- `ActivationControl` (master switch + kill-switch + gating)
- `ResponsibilityStrip`
- `AppropriatenessForm` + `AttestationBlock`
- `StrategyModuleList`
- `RiskLimitsPanel` with `LimitGauge` (two-sided / floor / capped / two-stage variants) and `StressMatrix`
- `ApiKeyList`
- `UpdatesPanel`
- `AuditLog` (`LedgerTable` + filters + export)
- `LoginDoor` (branded per role) + `DevDoorSwitch` (dev-only)

## 12. Open questions / decisions deferred

1. ~~**Activation precondition set** (§9)~~ — **Decided:** all four required (appropriateness + strategy + risk limits + active trading key).
2. **Two front doors** — separate subdomains vs two hash routes for v1.
3. **Admin shell** — leave as existing `DashboardApp`, or later add a client-roster → drill-into-client view.
4. **Audit tamper-evidence** — hash-chain in app vs DB trigger; export signing key management.
5. **Key secret handling** — exact encrypted-store mechanism (out of scope for this UI spec).

## 13. Non-goals

- No changes to the admin `DashboardApp` beyond the routing split.
- No real trading/venue execution changes — this is the client control & record surface.
- No investment advice, scoring, or recommendation features (by design).

## 14. Suggested phasing

1. **Shell & routing** — role router, `ClientPortalShell`, sidebar, responsibility strip, Dashboard +
   Positions (reusing current `ClientDashboardPage` logic). Login doors + dev switch.
2. **Setup surfaces** — Appropriateness, Strategy, Exchange keys, Updates + their tables.
3. **Risk engine** — `RiskLimitsPanel`, gauges, stress matrix, breach-behavior model, activation gating.
4. **Audit log & persistence** — Supabase tables, append-only audit spine, export.

Each phase is independently shippable behind the client role.
