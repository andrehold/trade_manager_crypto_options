# App-team quick start

The API is live. All-six-account production acceptance passed on 2026-10-21,
based on the operator-provided report. Known financial/source-coverage gaps remain.
The client and smoke tool use Python's standard library; the OpenAPI is portable.

1. Keep a `data:read` key on your server. Discover selectable accounts with
   `GET /api/v1/data/accounts`; map the six supported accounts explicitly.
2. Fetch `/api/v1/accounts/{id}/analytics/summary` with the desired UTC window,
   `metric=calculated_realized_gross_profit` and optional day/month/instrument/category
   grouping. Leave category unset to include expiry/delivery profit.
3. Display the Hub's value, currency, denomination and unit. Preserve decimal
   strings; show missing counts/notes alongside partial subtotals. Null is not zero.
4. Show saved-result freshness separately from collection time and financial
   availability. A ready build can contain unavailable profit. Keep history and
   inventory limitations visible; no baseline or equity-estimate setup is needed.
5. Open a cell using every returned dimension and the original metric. Use
   `drill_filters` to intersect UTC boundaries and select null partitions exactly.
   Consume `/transactions` to `next_cursor=null` with unchanged filters.
6. On 400/409 during pagination, discard partial pages and restart. Preserve the
   last complete response; never splice builds together.
7. Render `accounting` to explain prior basis and the close. Display venue profit
   separately. Fees/funding and execution-time mark comparisons remain independent.
   Use supplied summary bps; do not average row bps or compute cost basis in the app.
8. Keep accounts, venues and monetary/unit partitions separate. No historical FX
   conversion or cross-account aggregate endpoint is promised by this contract.
9. Validate against the reference examples and the full README/OpenAPI. Examples
   reuse approved historical evidence with synthetic identifiers and reconstruction
   notes; they are not live captures. UI-state examples are explicitly synthetic.
10. For subsequent releases or processing changes, repeat the provided
    read-only smoke over all six accounts. Confirm available calculated profit,
    complete pagination and period/day/month agreement before production sign-off.

Known economics still unavailable: Nickel spot cash basis, Paradex unwind basis
and USD/USDC conversion, missing execution marks, unresolved funding direction and
uncertified source completeness. Preserve those reasons rather than estimating them.
