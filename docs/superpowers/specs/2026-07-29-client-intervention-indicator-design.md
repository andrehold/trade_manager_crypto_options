# Client Intervention Indicator — Design

**Date:** 2026-07-29
**Status:** Approved for planning

## Problem

The client portal's Positions page lets a client Modify or Close a position, but
nothing on the row records that a client has intervened. Two distinct things
should surface the *same* signal to the client:

1. **Via the platform** — the client used the portal's Modify/Close control.
2. **Direct on the venue** — the client changed the position straight on their
   Deribit/CoinCall account, and the system/admin later detects that drift from
   what the software expects.

We want one indicator that means "the client intervened on this position,"
regardless of which channel it came through, with a tooltip that discloses the
actual source.

## Scope

**In scope now:**

- The row badge (indicator) in the client portal Positions page.
- A persisted data model that can carry both the `platform` and `venue` source.
- Wiring the **platform** channel live: Modify/Close records an intervention.
- Exposing the **venue** channel as a field the backend can write later (same
  table, `source = 'venue'`).

**Out of scope (noted for later):**

- Venue-vs-software drift *detection* that would power the venue channel. We only
  provide the table it writes to.
- Surfacing the badge on the admin dashboard.

## Decisions

- **Persistence:** dedicated Supabase table `position_interventions` (not columns
  on `positions`), so we keep history and give the venue channel a clean write
  target. Keyed by `position_id`, which Supabase already has.
- **Granularity:** position-level. The client's Positions page renders one row
  per option *leg*, but interventions are tracked per position and the badge
  shows on every leg row of an intervened position. This matches Supabase keying
  and the venue channel, which is naturally position-scoped.
- **Migration ownership:** this change includes the SQL migration (table + RLS).
- **Badge label:** a single neutral **"Modified"** for both channels; the tooltip
  carries the real source.

## Data model

New table:

```sql
position_interventions
  id           uuid primary key default gen_random_uuid()
  position_id  text not null          -- references positions.position_id by convention
  client_name  text
  source       text not null          -- 'platform' | 'venue'
  action       text not null          -- 'open' | 'modify' | 'close'
  detail       text
  created_by   uuid
  ts           timestamptz not null default now()
```

- Indexes on `position_id` and `client_name`.
- `enable row level security`, with `authenticated` select + insert policies,
  following the existing convention (see
  `supabase/migrations/20260325_clients_rls_update.sql`): access is granted to
  authenticated users and admin-vs-client scoping is enforced in the app layer
  via the `isAdmin` / `clientName` scope, matching `fetchSavedStructures` and
  `saveTransactionLogs`.
- Migration file: `supabase/migrations/20260729_add_position_interventions.sql`.

The badge reflects the **latest** intervention per `position_id` (max `ts`).

## Components

### `src/lib/positions/interventions.ts` (new)

Types and Supabase helpers, mirroring the shape of the other `lib/positions`
helpers (`{ ok: true, ... } | { ok: false, error }`).

```ts
export type InterventionSource = 'platform' | 'venue'
export type InterventionAction = 'open' | 'modify' | 'close'

export type PositionIntervention = {
  positionId: string
  source: InterventionSource
  action: InterventionAction
  detail?: string | null
  ts: string
}

export type InterventionMap = Map<string, PositionIntervention> // positionId -> latest

export async function fetchPositionInterventions(
  client: SupabaseClient,
  scope: SupabaseClientScope,
): Promise<{ ok: true; interventions: InterventionMap } | { ok: false; error: string }>

export async function recordPositionIntervention(
  client: SupabaseClient,
  params: {
    positionId: string
    source: InterventionSource
    action: InterventionAction
    detail?: string | null
    clientScope?: SupabaseClientScope
    createdBy?: string | null
  },
): Promise<{ ok: true } | { ok: false; error: string }>
```

- `fetchPositionInterventions` queries `position_interventions`, applies the same
  client-scoping rule as `fetchSavedStructures` (`.eq('client_name', name)` when
  `clientName` is set and not admin), orders by `ts` descending, and reduces to a
  latest-per-`position_id` map.
- `recordPositionIntervention` inserts one row, nullifying `undefined` fields
  (same pattern as `saveTransactionLogs`).

### `src/features/clientPortal/usePositionInterventions.ts` (new)

A hook that owns the intervention map for the portal session.

- Loads the fetched map (skips when there's no Supabase client, like
  `useClientPositions`).
- Keeps a **local optimistic overlay** so the badge appears instantly on click
  and so it works in **sample-data mode** (no Supabase client to write to).
- Exposes `record(positionId, action)`: updates the overlay immediately, and
  persists via `recordPositionIntervention` when a real client + Supabase client
  exist.
- Exposes the merged view (fetched ∪ overlay, latest `ts` wins) and a `reload`.

### `src/features/clientPortal/portfolio.ts` (edit)

Add `positionId: string` to `LegSummaryRow` and populate it from the parent
position (`p.id`) in `legSummaryRows`, so each per-leg row can look up its
position's intervention.

### `src/features/clientPortal/components/InterventionBadge.tsx` (new)

A small amber pill reading **"Modified"** (amber = divergence from the software's
plan, per the semantic token system), with a tooltip giving source + action +
time, e.g. *"You modified this via the platform · 29 Jul 14:03"* vs *"Changed
directly on venue · 29 Jul 14:03"*. Uses the existing design tokens; the tooltip
mechanism follows whatever pattern the design system already uses (native
`title` attribute is an acceptable baseline if there's no shared Tooltip).

### `src/features/clientPortal/pages/PositionsPage.tsx` (edit)

- New prop `interventions: InterventionMap`.
- In the `Option` column render, when `interventions.get(r.positionId)` exists,
  render `<InterventionBadge intervention={...} />` next to the option name.

### `src/features/clientPortal/ClientPortalShell.tsx` (edit)

- Use `usePositionInterventions(clientName)`.
- Pass the merged map to `PositionsPage`.
- In `onModify` / `onClose`, call `record(positionId, 'modify' | 'close')`
  alongside the existing `appendAudit(...)`. The handlers must receive the parent
  `positionId` (not the leg key); `PositionsPage` will pass `r.positionId`.

## Data flow

```
Supabase position_interventions ──fetchPositionInterventions──┐
                                                              ▼
                                          usePositionInterventions (merged map)
                                                              │
Modify/Close click ──record(positionId, action)──► overlay + recordPositionIntervention
                                                              │
                                                              ▼
                     ClientPortalShell ──interventions map──► PositionsPage
                                                              │
                                     row.positionId lookup ──► InterventionBadge
```

## Error handling

- `fetchPositionInterventions` failure: the page still renders positions; the
  badge simply doesn't show. Log/return the error like the other fetch helpers;
  do not block the Positions page on it.
- `recordPositionIntervention` failure: the optimistic overlay already showed the
  badge; surface the failure non-fatally (the audit append still happens). The
  next reload reconciles with the server truth.
- Sample-data / no-Supabase mode: no write is attempted; the overlay alone drives
  the badge for the session.

## Testing

- **`interventions` helper:** `fetchPositionInterventions` reduces multiple rows
  for the same `position_id` to the latest by `ts`; client scoping filter is
  applied when not admin. `recordPositionIntervention` builds the expected insert
  row and nullifies `undefined`.
- **`portfolio.ts`:** `legSummaryRows` populates `positionId` from the parent
  position on every leg row.
- **`PositionsPage`:** the "Modified" badge renders for a row whose `positionId`
  is in the map and not for others; the tooltip text reflects the source.

Follow the existing test setup (vitest + React Testing Library, per the
`__tests__` folders under `src/features/clientPortal`).
