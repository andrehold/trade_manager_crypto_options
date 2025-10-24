# Database Notes

This project keeps the core import payload intentionally lean while relying on PostgreSQL (Supabase) for referential integrity. The
`supabase/migrations/20240519_add_strategy_tables.sql` migration introduces the pieces recommended in the design review:

- **`strategies`** — catalog table keyed by `strategy_code` so shared definitions live once.
- **`program_strategies`** — associative table that links strategies to programs (room for effective-dating when needed).
- **`positions.strategy_name_at_entry`** — snapshot column to persist the human-readable label even if the catalog name changes later.
- **`positions_options_structure_chk`** — CHECK constraint that mirrors the enum defined in `src/lib/import/types.ts` to prevent drift.

Apply the migration through the Supabase SQL editor or CLI (for example `supabase db execute --file supabase/migrations/20240519_add_strategy_tables.sql`).

After running it, the import flows in `api/import/route.ts` and `src/lib/import/trades.ts` will automatically populate the new catalog/linkage tables during every import.
