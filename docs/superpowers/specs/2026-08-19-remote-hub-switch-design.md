# Switch to Remote Portfolio Data Hub (hub.germanquantum.tech)

**Date:** 2026-08-19
**Status:** Approved design, pending implementation plan

## Summary

The Portfolio Data Hub has been deployed at `https://hub.germanquantum.tech` backed by a
new Supabase database (the Hub's own backend). This app is already a hub-agnostic
**gateway**: `api/portfolio-data-hub/*` → `src/lib/portfolioDataHub/server.ts` authenticates
the browser user against **this app's own Supabase**, reads a `hub_account_id` mapping from
the `clients` table, then proxies to the Hub HTTP service at `PORTFOLIO_DATA_HUB_BASE_URL`.

The remote hub speaks the **same API contract** (`GET /api/v1/accounts/{id}/summaries/latest`,
`.../positions/latest`, `.../ledger-events`, Bearer-key auth, identical response shapes) as
the current local hub. Only the **account UUIDs differ** in the new database.

Therefore the switch is **not a code change to the data path**. It is:

1. A **configuration** change (repoint base URL + rotate API key), and
2. A **data remap** of `clients.hub_account_id` from old UUIDs → new hub UUIDs.

## What does NOT change

- App Supabase (auth, `clients`, positions, RLS) — unchanged.
- Gateway code (`server.ts`, `client.ts`), Zod schemas (`schemas.ts`), the
  `/api/portfolio-data-hub/*` routes, the account-ID cross-check — unchanged.
- Client-facing UI (`HubPortfolioView`, `usePortfolioDataHub`, reporting-currency selector) —
  unchanged.
- The remap mechanism — **already exists** as the `admin_set_client_hub_account_mapping`
  RPC (see `supabase/migrations/20260812091000_portfolio_data_hub_mapping.sql`). **No new
  migration is required.**

## What changes

### 1. Configuration

Set on Vercel **Production** and in local `.env`:

- `PORTFOLIO_DATA_HUB_BASE_URL` = `https://hub.germanquantum.tech`
- `PORTFOLIO_DATA_HUB_API_KEY` = the new hub's production key. **Prerequisite:** the new hub
  issues *scoped* bearer keys (`POST /api/v1/api-keys` with `scopes`). The portal key must
  carry the scopes needed to read data accounts, summaries, positions, and ledger-events
  (the portal never reads raw batches, so `raw:read` is not required). Confirm scopes before
  cutover — a scope gap surfaces as `HUB_UNAVAILABLE` at runtime.
- `PORTFOLIO_DATA_HUB_TIMEOUT_MS` — leave default (10000) unless the new host is slower.

The existing preflight (`scripts/portfolio-data-hub-preflight.mjs`, run via the `pnpm`
scripts added in commit `0144242`) already enforces: non-`VITE_`-prefixed, absolute HTTPS URL,
non-loopback in production, key present. It gates a bad config at build time.

`.env.example` and `docs/DEPLOY.md` are updated to name the new host and drop the loopback
default guidance from the production instructions.

### 2. Data remap of `clients.hub_account_id`

**Mechanism (existing):** `public.admin_set_client_hub_account_mapping(p_client_id uuid,
p_hub_account_id uuid, p_hub_account_label text)`.

- `security definer`, gated to `helpers.is_admin()` OR `helpers.is_service_role()`.
- Updates `hub_account_id` + `hub_account_label`; the
  `enforce_client_hub_mapping_fields` trigger auto-stamps `hub_account_mapped_at = now()`
  when the ID changes.
- The `audit_client_hub_mapping_change` trigger writes an old→new row to
  `client_account_config_audit`, so every remap is durably recorded and reversible.

**Match key (resolved from the hub OpenAPI):** the account listing is
`GET /api/v1/data/accounts` → `DataAccountPage.items[]`, each
`{ id (new UUID), label, venue, environment, external_account_identifier, enabled }`. The app
already has a matching parser (`dataAccountPageSchema` in `schemas.ts`), confirming this is
the intended consumer contract. We join portal clients to new hub accounts on
`clients.hub_account_label == item.label`, **guarded by `venue`**, and record
`external_account_identifier` per row as an extra confidence key. Ambiguity (a label matching
more than one enabled account, or vice versa) is a hard stop for human resolution.

## The remap procedure (build → verify → apply → verify)

The gateway's account-ID cross-check only catches a Hub *response* that disagrees with the
*stored* ID. It does **not** catch a *wrong stored* ID. A mis-map silently shows client A
client B's portfolio. The procedure is therefore defensive:

1. **Build the mapping table.**
   - Fetch the new hub's admin account listing → `{ new_uuid, label, venue, known_figure }`.
   - Read current `clients` → `{ client_id, client_name, hub_account_id (old), hub_account_label }`.
   - Join on label (→ venue fallback) to produce an explicit
     `client_id → new_uuid` table, including the old UUID for each row.
   - **Hard stop** if any active/mapped client is unmatched, or any new_uuid matches more
     than one client, or any client matches more than one new_uuid. Emit the table for
     human review before any write.

2. **Apply** per client via `admin_set_client_hub_account_mapping` (service-role script or
   admin session), one call per client. Capture the pre-change `hub_account_id` per client
   (also preserved in `client_account_config_audit`) as the rollback set.

3. **Verify each client with a known figure (chosen depth).**
   For every remapped client, call `GET /api/v1/accounts/{new_uuid}/summaries/latest`
   (`SummaryView`) with the portal key and assert BOTH:
   - the returned `venue` and `account_label` match what we mapped, AND
   - a **known summary figure** — a chosen `components[]` entry's `equity` (or `balance`) in
     the expected currency — matches the expected value for that client within tolerance.
     (Values are exact decimal strings; compare with a decimal tolerance, never as floats.)
   Any client that fails either assertion → **rollback that client** (re-apply its old UUID)
   and halt for investigation.

4. **Rollback plan:** revert env vars to the old hub + re-apply the captured old UUIDs via
   the same RPC. The old hub is kept reachable until production is verified and soaked.

## Cutover sequencing (direct production switch)

Chosen style: **direct** (small client count, accept a brief risk window). Old hub stays up
for rollback.

1. Land config/doc/script changes on a branch; run preflight (`--production`) to confirm
   config validity without contacting the hub.
2. **Window start:** set Production env vars (base URL + new key) and redeploy.
3. Run the remap script (step 1 build → human-review the table → step 2 apply →
   step 3 verify).
4. Smoke-test: one real client login end-to-end (overview loads, figures correct); confirm
   the admin reporting-currency selector still resolves for a mapped client.
5. **Window end.** Monitor. Decommission the old hub only after a soak period.

## Deliverables

- **Remap script** under `scripts/` (e.g. `scripts/remote-hub-remap.mjs`):
  build table → emit for review → apply via RPC → verify known figure. Reads the new-hub
  admin listing and the app's service-role Supabase key from the environment; prints no
  secrets. Includes a `--dry-run` that stops after emitting the table, and a `--rollback`
  that re-applies captured old UUIDs.
- **`.env.example`** + **`docs/DEPLOY.md`** updated for the new host.
- **Cutover + rollback runbook** (can live in `docs/DEPLOY.md` or a dedicated runbook file).

## Non-goals (YAGNI)

- No changes to the app's own Supabase project, schema, or RLS.
- No gateway/schema/UI code changes for the data path.
- No new migration (the remap RPC already exists).
- No Preview-environment dry-run (direct cutover was chosen).
- No automated account auto-discovery beyond the label/venue join — the mapping table is
  human-reviewed before any write.

## Reference

The switch was validated against the hub's published `openapi.json` (Portfolio Data Hub
`0.1.0`, Canonical Contract v1). Key confirmations:

- The gateway's three data paths all exist unchanged: `/api/v1/accounts/{id}/summaries/latest`
  (`SummaryView`), `/api/v1/accounts/{id}/positions/latest` (`LatestPositionPage`),
  `/api/v1/accounts/{id}/ledger-events` (`LedgerEventPage`).
- Response field naming is snake_case v1 and matches `src/lib/portfolioDataHub/schemas.ts`
  exactly (e.g. `dataAccountPageSchema` ↔ `DataAccountView`); `normalizers.ts` maps to the
  gateway's camelCase `Hub*` types. **No schema/gateway code changes.**
- Auth is a single `HTTPBearer` key with scopes → the `PORTFOLIO_DATA_HUB_API_KEY` model is
  unchanged; only the key value and its scope grant matter.

## Open items to confirm during implementation

- The **service-role key** source (Supabase secret / env var name) the remap script uses to
  call `admin_set_client_hub_account_mapping`, and the **portal key** the script uses to read
  `/api/v1/data/accounts` and the per-account summaries at verification time.
- The **expected known-figure value** per client (which currency/component and the source of
  truth for the expected number) — supplied at run time, not hardcoded.
