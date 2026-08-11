# Client Portal — Login & Access Setup

How the app decides whether a signed-in user sees the **admin desk** (`DashboardApp`) or the
**client portal** (`src/features/clientPortal/`), and how to configure a client login.

## How the decision is made

`src/RootRouter.tsx` routes on `resolveClientAccess(user)` (`src/features/auth/access.ts`):

```
isAdmin = app_metadata.role === "admin"  ||  email ∈ VITE_SUPABASE_ADMIN_EMAILS
```

- **Admin** → the existing `DashboardApp` (full desk, all clients).
- **Not admin** → the client portal shell.

**Fail closed:** an empty/unset `VITE_SUPABASE_ADMIN_EMAILS` grants **nobody** admin. A missing env
var can never expose the admin desk to a client — but it also means *you* won't be admin until the
allowlist (or an `admin` role) is configured.

## 1. Configure the admin allowlist (`VITE_SUPABASE_ADMIN_EMAILS`)

Comma-separated list of the emails that should get the admin desk. **Do not** put client emails here.

- **Vercel:** Project → Settings → **Environment Variables** → add
  `VITE_SUPABASE_ADMIN_EMAILS = you@example.com` for the **Production** environment (and Preview/Dev
  if you use them).
- **Local:** add to `.env.local`:
  ```
  VITE_SUPABASE_ADMIN_EMAILS=you@example.com
  ```

> ⚠️ **Vite bakes env vars at build time.** After adding or changing this value you must
> **redeploy / rebuild** — an already-running deployment keeps the old value. On Vercel: redeploy or
> push a commit. Locally: restart `pnpm dev`.

Alternatively, a user can be made admin via `app_metadata.role = "admin"` (server-side only — see the
metadata note below), independent of the allowlist.

## 2. Create a client user

Supabase Dashboard → **Authentication → Users** → **Add user** → **Create new user** → email +
password, tick **Auto Confirm User**. Use an email that is **not** in `VITE_SUPABASE_ADMIN_EMAILS`.

## 3. Link the client to its portal account

The configured portal resolves the canonical `client_name` from the caller's own
`public.clients` row. Its authority comes only from
`app_metadata.client_id`; editable `user_metadata` is never used to choose the
account. Set the matching UUID after creating both the Auth user and the portal
client row:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object(
  'client_id', '00000000-0000-0000-0000-000000000000'
)
where email = 'client@example.com';
```

The UUID must be the corresponding `public.clients.client_id`. The user must sign
out and back in once after this server-side app-metadata change so the JWT is
refreshed.

`user_metadata.client_name` may still be set for local/no-Supabase demo display,
but it is optional in configured environments and has no authorization effect.

## 4. Log in

- Go to **`#/login`** (the default client door) and sign in with the client user's email/password.
- Authenticated + non-admin → the **client portal shell**.
- In a **dev build** (`pnpm dev`) a bottom-left **DEV** switch flips between the Client/Admin login
  doors; it does not render in the production build.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Client logs in but sees the **admin desk** | `resolveClientAccess` returned `isAdmin: true` | The client's email is in `VITE_SUPABASE_ADMIN_EMAILS`, or their `app_metadata.role` is `admin`. Remove it. |
| **You** (admin) now land in the client portal | Fail-closed default + allowlist not applied | Add your email to `VITE_SUPABASE_ADMIN_EMAILS` **and redeploy/rebuild** (env is baked at build time), or set your `app_metadata.role = "admin"`. |
| Portal says the account is not linked | Missing/invalid `app_metadata.client_id`, or no matching `public.clients` row | Set the correct UUID in app metadata and sign out/in. |
| Portal loads but shows **no positions** | The canonical client row has no matching positions, or account mapping data is unresolved | Check `public.clients.client_id` and the matching rows' `client_id`; do not use user metadata to scope data. |
| New app metadata not taking effect | Stale session token | Sign the user out and back in (claims are read from the token). |

Verify a user's resolved state:
```sql
select email,
       raw_app_meta_data ->> 'role'        as role,
       raw_app_meta_data ->> 'client_id'   as client_id,
       raw_user_meta_data ->> 'client_name' as optional_display_name
from auth.users
where email = 'client@example.com';
```

## Admin DB access (client-portal persistence)

Client-portal tables (`appropriateness_assessments`, `strategy_selections`, …) use per-client RLS.
A client can only read/write their own rows. For an **admin** to read all clients' rows via RLS, the
admin user must carry `app_metadata.role = 'admin'` — the `VITE_SUPABASE_ADMIN_EMAILS` allowlist is
browser-only and invisible to Postgres. Set it in the Supabase SQL editor:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where email = 'you@example.com';
```
