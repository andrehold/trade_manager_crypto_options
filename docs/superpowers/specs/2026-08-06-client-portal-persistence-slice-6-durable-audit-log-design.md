# Client Portal Persistence — Slice 6: Durable audit log

**Date:** 2026-08-06
**Status:** Design approved → ready for implementation planning
**Scope:** Sixth slice of Phase 4 (persistence) — the capstone. Make the client portal's general audit log
durable in Supabase, so every client action is recorded in an append-only `audit_events` table and the
Audit log page shows the client's real persisted history on reload. Reuses the per-client-RLS + repo +
`useSetupPersistence` hook + graceful-degradation pattern from Slices 1–5.

---

## 1. Context & goal

The client portal records every client action through a single chokepoint — `appendAudit(type, detail,
actor)` in `ClientPortalShell` — which prepends a `newEvent(...)` to an in-session `auditEvents` list
seeded from illustrative `SEED_AUDIT_EVENTS`. Every domain handler (appropriateness, strategy, risk, key
add/revoke, activation toggle, update approve, position modify/close) funnels through it. On reload the
list resets to the seed.

This slice makes those audit entries durable: `appendAudit` writes each entry to an append-only
`audit_events` table, and on load the Audit log page shows the client's actual persisted history. It
satisfies the "keeps complete audit logs" criterion end-to-end.

## 2. Decisions (from brainstorming)

- **Dedicated `audit_events` table, written via the `appendAudit` chokepoint** — chosen over deriving the
  log from the six per-surface tables. It keeps the single change point, the rich hand-composed `detail`
  strings, and captures every event type (including `system`/`EXECUTION` events that have no domain table).
- **Best-effort write** — the domain action already persists its own data persist-first; the audit entry is
  a secondary record. `appendAudit` fires the `audit_events` insert in the background: the optimistic
  in-session prepend gives immediate feedback, and a write failure is logged (console) but never blocks the
  action or surfaces a banner. (Guaranteed-complete writes would need a DB trigger — noted as future
  hardening, not in scope.)
- **Real history on load; SEED only as the no-DB fallback** — the page shows the client's actual persisted
  entries. When the real log is empty *and* Supabase is unconfigured, it falls back to `SEED_AUDIT_EVENTS`
  (degradation demo); when Supabase is configured and the log is empty, it shows the existing empty-state.
- **Per-client RLS** — same isolation boundary as prior slices (client reads/inserts only their own rows;
  admin `role='admin'` reads all).
- **Graceful degradation** — Supabase unconfigured or a fetch/save failure never hard-breaks the portal.

## 3. Schema

One append-only table, following the `supabase/migrations/` convention (`public.<name>`, `id uuid`,
`client_name text` scoping, `created_by uuid default auth.uid()`, `ts timestamptz`, indexes on
`client_name` and `(client_name, ts)`).

### 3.1 `20260808_add_audit_events.sql`

```sql
-- Append-only client audit log. Every client/system action is recorded as one immutable row.
-- type/actor stored as free text (the UI tolerates unknown types via a colour fallback). Same
-- per-client RLS + admin-read pattern.
create table if not exists public.audit_events (
  id          uuid primary key default gen_random_uuid(),
  client_name text not null,
  created_by  uuid default auth.uid(),
  type        text not null,
  detail      text not null,
  actor       text not null,
  ts          timestamptz not null default now()
);

create index if not exists audit_events_client_idx
  on public.audit_events (client_name);
create index if not exists audit_events_client_ts_idx
  on public.audit_events (client_name, ts);

alter table public.audit_events enable row level security;

create policy "Clients read own audit events"
  on public.audit_events for select
  using (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Clients insert own audit events"
  on public.audit_events for insert
  with check (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Admins read all audit events"
  on public.audit_events for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
```

> The insert `with check` prevents a client from writing rows under another client's name. There is no
> update or delete policy — the log is append-only, matching its "append-only · tamper-evident" label.

## 4. App layer

### 4.1 Repo (`src/lib/clientPortal/auditRepo.ts`)

Following the `strategyRepo` / `exchangeKeysRepo` style (return a discriminated `{ ok }` result; never
throw). `AuditEvent`/`AuditType`/`AuditActor` are imported from `src/features/clientPortal/audit.ts`
(single source; the repo does not redefine them).

- `mapAuditRow(row: unknown): AuditEvent | null` — **pure, exported.** Validates the untyped row has string
  `id`, `type`, `detail`, and `ts`; coerces `actor` to `'system'` when the value is exactly `'system'`,
  otherwise `'client'`; casts `type` to `AuditType` (the page tolerates unknown types). Returns `null` on a
  missing/wrong-typed required field, so a malformed row is dropped rather than crashing.
- `fetchAuditEvents(supabase, clientName): Promise<{ ok: true; events: AuditEvent[] } | { ok: false; error: string }>`
  — selects `id, type, detail, actor, ts` ordered by `ts desc`, maps each with `mapAuditRow` (dropping
  nulls).
- `saveAuditEvent(supabase, clientName, event: AuditEvent): Promise<{ ok: true } | { ok: false; error: string }>`
  — inserts `{ client_name, type: event.type, detail: event.detail, actor: event.actor, ts: event.ts }`
  (the client-composed detail and client `ts`, so the persisted row matches the optimistic entry).

### 4.2 Hook (`useSetupPersistence`)

Extend the existing hook:

- Add `fetchAuditEvents` to the existing `Promise.all`; add state `persistedAudit: AuditEvent[]` (default
  `[]`), set from a successful fetch.
- Return `persistedAudit` and a `saveAuditEvent(event): Promise<{ ok; error? }>` callback that wraps the
  repo insert and re-exposes its result. Like the existing saves, `!hasSupabaseClient()` short-circuits
  `saveAuditEvent` to `{ ok: true }` (in-session only, no error).

### 4.3 Shell (`ClientPortalShell`)

Refactor the in-session audit state to layer the session's new entries over the persisted history:

- Replace `const [auditEvents, setAuditEvents] = React.useState<AuditEvent[]>(SEED_AUDIT_EVENTS)` with
  `const [sessionAudit, setSessionAudit] = React.useState<AuditEvent[]>([])` — this session's new entries
  only, initial empty.
- `appendAudit(type, detail, actor='client')` builds the event once, prepends it to `sessionAudit`
  (optimistic), and fires the persist **best-effort**:

  ```ts
  const appendAudit = React.useCallback((type: AuditType, detail: string, actor: AuditActor = 'client') => {
    const e = newEvent(type, detail, actor)
    setSessionAudit((evs) => [e, ...evs])
    persistence.saveAuditEvent(e).then((r) => { if (!r.ok) console.error('audit persist failed', r.error) })
  }, [persistence.saveAuditEvent])
  ```

- Derived display, falling back to the seed only when there is genuinely nothing to show and no persistence
  is configured:

  ```ts
  const shownAudit = React.useMemo(() => {
    const real = [...sessionAudit, ...persistence.persistedAudit]
    if (real.length > 0) return real
    return hasSupabaseClient() ? [] : SEED_AUDIT_EVENTS
  }, [sessionAudit, persistence.persistedAudit])
  ```

- Render `<AuditLogPage events={shownAudit} clientName={clientName} />`.
- Session events are not in `persistedAudit` until a future reload, so there is no double-count within a
  session. The shell imports `hasSupabaseClient` from `@/lib/supabase`.

### 4.4 AuditLogPage

Unchanged — it already takes `events` as a prop, sorts by `ts desc`, filters by type/actor, and renders a
per-filter empty-state.

### 4.5 Data flow

```
login → ClientPortalShell mounts → useSetupPersistence(clientName)
     → fetchAuditEvents (RLS scopes to client) → mapAuditRow* → persistedAudit
client acts → appendAudit(type, detail)
     → prepend to sessionAudit (optimistic) + saveAuditEvent(insert, best-effort)
Audit log page → shownAudit = sessionAudit ++ persistedAudit  (SEED only if empty && !hasSupabaseClient)
```

### 4.6 Graceful degradation

- `!hasSupabaseClient()` → hook returns `persistedAudit: []`; `saveAuditEvent` short-circuits to `{ ok: true }`;
  `shownAudit` falls back to `SEED_AUDIT_EVENTS`. Portal behaves as an in-session demo log. No error shown.
- Fetch error → treated as "no history" for `persistedAudit`, logged to console; portal still usable.
- Save error → logged to console; the optimistic in-session entry still shows, and nothing blocks or
  surfaces (best-effort). The compliance record is as complete as the client write is reliable — see the
  DB-trigger non-goal.

## 5. Testing

- **`mapAuditRow` (pure)** — a well-formed row maps to `AuditEvent`; a row missing `id`/`type`/`detail`/`ts`
  or with a non-string one returns `null`; `actor: 'system'` maps to `'system'`, any other value to
  `'client'`.
- **Repo** — against a mocked Supabase client (chainable `from().select().eq().order()` and `from().insert()`):
  `fetchAuditEvents` returns the mapped events (dropping a malformed row) and asserts the correct table,
  `client_name` filter, and `ts desc` order; `saveAuditEvent` inserts the `{ client_name, type, detail,
  actor, ts }` payload; error results on query/insert failure.
- **Hook** — with repos mocked: seeds `persistedAudit` from a fetched set; `saveAuditEvent` delegates and
  returns the repo result; `!hasSupabaseClient()` short-circuits.
- **Shell** — with `useSetupPersistence` mocked: a fetched `persistedAudit` entry renders on the Audit log
  page; a client action (e.g. approve update) adds a visible audit entry *and* calls `saveAuditEvent`; with
  no persisted history and no Supabase configured (the default test environment), the page shows the
  `SEED_AUDIT_EVENTS` fallback — so the existing "renders the audit log with seed entries" test keeps
  passing. The shared `baseSetupPersistence` mock gains `persistedAudit: []` and
  `saveAuditEvent: async () => ({ ok: true })`.

## 6. Operational notes

- **You run the migration.** I write `supabase/migrations/20260808_add_audit_events.sql`; you apply it to
  your Supabase project. Until applied, the fetch returns an error and graceful degradation keeps the portal
  working in-session (SEED fallback / optimistic entries).
- **Admin DB access requires `app_metadata.role = 'admin'`**, same as prior slices — the admin `select`
  policy keys off the JWT `role` claim, not the browser-only allowlist.

## 7. Non-goals / deferred

- **Guaranteed-complete writes via a DB trigger** — the best-effort client write can, in principle, miss an
  entry if the insert fails; a server-side trigger that writes an `audit_events` row on every domain-table
  insert would make the log provably complete. Deferred (browser-direct architecture; future hardening).
- The **"Export signed CSV"** button remains a stub, and the "tamper-evident" label is aspirational (no
  cryptographic chaining) — out of scope.
- Admin compliance-oversight UI consuming the admin-read policy.
- Persisting the illustrative `SEED_AUDIT_EVENTS` — they are display-only fallback and are never written.
