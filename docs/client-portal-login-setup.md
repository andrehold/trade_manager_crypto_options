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

## 3. Set the client's `client_name`

The portal reads `user_metadata.client_name` for the display name and to scope positions
(`fetchSavedStructures` filters by it). The "Create user" form has no metadata field, so set it after:

**SQL Editor (reliable):**
```sql
update auth.users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"client_name":"TwoPrime"}'::jsonb
where email = 'client@example.com';
```

`raw_user_meta_data` is the DB column behind `user_metadata`; the `|| jsonb` merge adds/overwrites only
`client_name` and preserves other keys. Newer Supabase dashboards also expose an editable **User
Metadata** JSON box on the user's detail panel — if present, set `{ "client_name": "TwoPrime" }` there.

`client_name` should match the `clientName` stored on that client's rows in the `positions` table,
otherwise the portal loads but shows no client-scoped positions. (`client_id` is optional and, if set,
must be a UUID.)

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
| Portal loads but shows **no positions** | `client_name` mismatch | Make `user_metadata.client_name` match the `clientName` on the client's `positions` rows. |
| New metadata not taking effect | Stale session token | Sign the user out and back in (metadata is read from the token). |

Verify a user's resolved state:
```sql
select email,
       raw_app_meta_data ->> 'role'        as role,
       raw_user_meta_data ->> 'client_name' as client_name
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
