# Client Portal Persistence — Slice 5: Update approvals

**Date:** 2026-08-06
**Status:** Design approved → ready for implementation planning
**Scope:** Fifth (final capability) slice of Phase 4 (persistence). Wire the **Software updates**
approval surface to Supabase so the client's approve-and-install decision survives reload. Reuses the
per-client-RLS + repo + `useSetupPersistence` hook + promote-only seeding + persist-first +
graceful-degradation pattern from Slices 1–4.

---

## 1. Context & goal

The client portal's Updates page (`src/features/clientPortal/pages/UpdatesPage.tsx`) shows a hardcoded
current version, one hardcoded pending update (`v2.4.1`) with a changelog, and an illustrative
release-history list. Approving sets a local `installed` boolean and calls `onApprove(ver)`, which the
shell records as an in-session `UPDATE` audit event — reload and the pending update resets to "available".

This slice makes the client's **update approvals** durable in Supabase, so on next login a previously
approved update renders as **Installed** rather than pending. It satisfies the "client approves and
installs updates" criterion. Updates are **not** a setup precondition, so nothing here touches the
activation gate.

## 2. Decisions (from brainstorming)

- **Append-only approval log** — one `update_approvals` table of immutable `(version, ts)` rows; the set
  of approved versions is read on load. Consistent with the append-only convention.
- **Persist the approval decision only; the pending update stays UI config** — the "available update"
  (`v2.4.1` + changelog) remains a hardcoded constant in `UpdatesPage`; this slice records which versions
  the client approved and restores the Installed state from that. No update catalog / version feed.
- **Release-history list stays illustrative** — the hardcoded past-releases list at the bottom of the page
  is the software's release log, not the client's approval record; it is unchanged. (The client's real
  approvals are captured in the audit log and the new `update_approvals` table.)
- **Per-client RLS** — same isolation boundary as prior slices (client reads/inserts only their own rows;
  admin `role='admin'` reads all).
- **Graceful degradation** — Supabase unconfigured or a fetch/save failure never hard-breaks the portal;
  it falls back to today's in-session behavior.

## 3. Schema

One append-only table, following the `supabase/migrations/` convention (`public.<name>`, `id uuid`,
`client_name text` scoping, `created_by uuid default auth.uid()`, `ts timestamptz`, indexes on
`client_name` and `(client_name, ts)`).

### 3.1 `20260807_add_update_approvals.sql`

```sql
-- Append-only client software-update approvals. The set of approved versions is read on load to restore
-- the "installed" state of pending updates. Same per-client RLS + admin-read pattern.
create table if not exists public.update_approvals (
  id          uuid primary key default gen_random_uuid(),
  client_name text not null,
  created_by  uuid default auth.uid(),
  version     text not null,
  ts          timestamptz not null default now()
);

create index if not exists update_approvals_client_idx
  on public.update_approvals (client_name);
create index if not exists update_approvals_client_ts_idx
  on public.update_approvals (client_name, ts);

alter table public.update_approvals enable row level security;

create policy "Clients read own update approvals"
  on public.update_approvals for select
  using (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Clients insert own update approvals"
  on public.update_approvals for insert
  with check (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Admins read all update approvals"
  on public.update_approvals for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
```

> The insert `with check` prevents a client from writing rows under another client's name. There is no
> update or delete policy — the log is append-only.

## 4. App layer

### 4.1 Repo (`src/lib/clientPortal/updatesRepo.ts`)

Following the `strategyRepo` style (return a discriminated `{ ok }` result; never throw):

- `fetchApprovedVersions(supabase, clientName): Promise<{ ok: true; versions: string[] } | { ok: false; error: string }>`
  — selects `version` for the client, maps rows to a **deduped** array of version strings (a row with a
  non-string `version` is skipped). Order is not significant (membership check only).
- `saveUpdateApproval(supabase, clientName, version: string): Promise<{ ok: true } | { ok: false; error: string }>`
  — inserts `{ client_name, version }`.

### 4.2 Hook (`useSetupPersistence`)

Extend the existing hook:

- Add `fetchApprovedVersions` to the existing `Promise.all`; add state `approvedVersions: string[]`
  (default `[]`), set from a successful fetch.
- Return `approvedVersions` and a `saveUpdateApproval(version): Promise<{ ok; error? }>` callback that wraps
  the repo insert and re-exposes its result. Like the existing saves, `!hasSupabaseClient()` short-circuits
  `saveUpdateApproval` to `{ ok: true }` (in-session only, no error).

### 4.3 Shell (`ClientPortalShell`)

- **Null-sentinel state:** `approvedVersions: string[] | null` (initial `null` = "not seeded/touched");
  `const effectiveApproved = approvedVersions ?? []` is passed to `UpdatesPage`. Mirrors the `exchangeKeys`
  null-sentinel.
- **Seeding (promote-only):** in the existing load-seed effect, when `persistence.approvedVersions` is
  non-empty, seed the list (`setApprovedVersions((cur) => cur ?? persistence.approvedVersions)`). Add
  `persistence.approvedVersions` to the effect deps. (Updates have no precondition, so nothing in
  `setupStatus` changes.)
- **Persist-first approve:** `approveUpdate(ver)` becomes async — `await persistence.saveUpdateApproval(ver)`;
  on failure set `persistError` and change nothing; on success append the version to `effectiveApproved`
  deduped (seeding from `[]` if still null), clear `persistError`, and append the existing `UPDATE` audit
  event.

### 4.4 UpdatesPage (`src/features/clientPortal/pages/UpdatesPage.tsx`)

- Props change from `{ onApprove }` to `{ approvedVersions: string[]; onApprove: (ver: string) => void }`.
- The pending update stays a constant (`const PENDING = { ver: 'v2.4.1', changelog: [...] }`). The local
  `installed` state is removed; `installed` is derived: `const installed = approvedVersions.includes(PENDING.ver)`.
- Clicking "Approve & install" calls `onApprove(PENDING.ver)` (no local state flip; the shell persists and
  updates `approvedVersions`, which re-renders this page as Installed). The button is disabled when
  `installed`; the "1 pending your approval" badge shows when `!installed`.
- The changelog and the illustrative release-history list stay hardcoded.

### 4.5 Data flow

```
login → ClientPortalShell mounts → useSetupPersistence(clientName)
     → fetchApprovedVersions (RLS scopes to client) → deduped versions
     → seed approvedVersions (promote-only)
client approves → saveUpdateApproval(insert version) → ok
     → approvedVersions += version (deduped) + UPDATE audit
     → UpdatesPage re-renders Installed
```

### 4.6 Graceful degradation

- `!hasSupabaseClient()` → hook returns `approvedVersions: []`; `saveUpdateApproval` short-circuits to
  `{ ok: true }`. Portal behaves as an in-session approval. No error shown.
- Fetch error → treated as "no approvals" for seeding, logged to console; portal still usable.
- Save error → `approveUpdate` shows the inline `persistError` banner and changes nothing, so the client can
  retry.

## 5. Testing

- **Repo** — against a mocked Supabase client (chainable `from().select().eq()` and `from().insert()`):
  `fetchApprovedVersions` returns the deduped version set on success, `[]` with no rows, and skips a
  non-string `version`; asserts the correct table and `client_name` filter. `saveUpdateApproval` inserts
  `{ client_name, version }`. Error results on query/insert failure.
- **Hook** — with repos mocked: seeds `approvedVersions` from a fetched set; `saveUpdateApproval` delegates
  and returns the repo result; `!hasSupabaseClient()` short-circuits.
- **UpdatesPage** — with the pending version in `approvedVersions`, renders Installed (button disabled, no
  pending badge); with it absent, renders available and clicking calls `onApprove('v2.4.1')`.
- **Shell** — with `useSetupPersistence` mocked: a fetched `approvedVersions` containing the pending version
  restores the Updates page to Installed on mount; a persist-first approve failure shows the banner and
  leaves the update pending. Existing shell tests stay green — the shared `baseSetupPersistence` mock gains
  `approvedVersions: []` and `saveUpdateApproval: async () => ({ ok: true })`.

## 6. Operational notes

- **You run the migration.** I write `supabase/migrations/20260807_add_update_approvals.sql`; you apply it
  to your Supabase project. Until applied, the fetch returns an error and graceful degradation keeps the
  portal working in-session.
- **Admin DB access requires `app_metadata.role = 'admin'`**, same as prior slices — the admin `select`
  policy keys off the JWT `role` claim, not the browser-only allowlist.

## 7. Non-goals / deferred

- The durable general **audit log** — the in-session `auditEvents` list (seeded from `SEED_AUDIT_EVENTS`)
  is unchanged; making the whole audit log durable is a separate, later concern. (Each surface's
  append-only `*_events` / `*_approvals` table is already a durable per-surface record.)
- Rendering the client's real approval history in the release-history list (chose illustrative).
- A real update catalog / version feed — the pending update stays hardcoded UI config.
- Admin compliance-oversight UI consuming the admin-read policy.
