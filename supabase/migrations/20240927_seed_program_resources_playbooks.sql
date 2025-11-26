-- Seed playbook-style guidance for the expanded program_playbooks table.
-- Titles align with the tactics referenced in the product brief.

insert into public.program_playbooks (
  playbook_id,
  program_id,
  title,
  profit_rule,
  stop_rule,
  time_rule,
  risk_notes
) values
  (
    gen_random_uuid(),
    'expected_move_condor',
    'Expected Move / Condor',
    'Profit: close at +50% of credit.',
    'Stop: −150% of credit (earlier if short strike breached).',
    'Time: exit at 25–35% DTE left if ≥30% profit not reached.',
    $$Delta/Gamma: |Δ| > 10–15% NAV or Γ > 2× θ near expiry → reduce/close.
IV/Skew: IV–RV < +2 vol pts or IVR > 80% or RR shift > 5 pts → reduce.
EM/Range: close if close outside EM or −1× EM beyond short strike.
Event: Flatten T−1 for CPI/FOMC/ETF if wings tight.$$
  ),
  (
    gen_random_uuid(),
    'weekend_vol_short_dated',
    'Weekend Vol (Short-Dated)',
    'Profit: hold to expiry if within EM; optional Sun 18–20 UTC close if >70%.',
    'Stop: −100% credit or EM breach with momentum.',
    'Time: expiry-driven.',
    $$Δ/Γ: |Δ| > 15% or Γ spike → trim/close.
IV: 0–2D IV −20% vs entry → take profit.
Funding: >|±15%| → cut size.$$
  ),
  (
    gen_random_uuid(),
    'range_bound_premium',
    'Range-Bound Premium Selling',
    'Profit: +50% (partial at +30%).',
    'Stop: −150% or confirmed breakout.',
    'Time: exit at 30–40% DTE if <30% profit.',
    $$Range: close on >3× ATR or >1.5σ VWAP with volume.
Curve: backwardation or IV pct > 50% → reduce.$$
  ),
  (
    gen_random_uuid(),
    'carry_trade_iv_gt_rv',
    'Carry Trade (IV>RV Edge)',
    'Profit: take when IV–RV < +3 vol pts or +50% PnL.',
    'Stop: RV>IV two days or DD > 1.5× θ/day.',
    'Time: if no profit by 50% of tenor and edge decays → reduce/exit.',
    $$Curve: IVR > 80% or backwardation → cut.
Ops: vega cap ≤10% NAV per expiry; utilization ≤50% NAV.$$
  ),
  (
    gen_random_uuid(),
    'parity_edge_options_futures',
    'Parity Edge (Options–Futures)',
    'Profit: lock ≥70–80% of initial edge (sats) on reversion.',
    'Stop: if spread+slippage ≥ buffer, cap at −1× buffer.',
    'Time: reversion half-life × 1.5 time stop.',
    $$Basis: misalignment vs options leg → exit/rehash.
Micro: skip/exit if spreads to 95p or depth falls.$$
  ),
  (
    gen_random_uuid(),
    'zero_dte_overwrite',
    '0DTE Overwrite',
    'Profit: +60–80% intraday, or at 50–75% session elapsed.',
    'Stop: −150% credit or price > +1.5σ VWAP.',
    'Time: close EOD if >70% target achieved.',
    $$IV: intraday IV +20% vs entry → reduce/close.
Funding: >|±10%| = crowding → lighten.$$
  ),
  (
    gen_random_uuid(),
    'box_financing_implied_funding',
    'Box Financing (Implied Funding)',
    'Profit: hold if r_imp − costs ≥ +20 bps (annualized); close if ≥80% captured.',
    'Stop: r_imp − costs < +5–10 bps or fees/slippage rise.',
    'Time: roll at T−5–10 days or when better box appears.',
    $$Risk: avoid American ex-div; prefer European index.
Funding: unwind if OIS/T-bill vs r_imp narrows.$$
  );
