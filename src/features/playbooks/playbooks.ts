import React from 'react'

export type PlaybookListSection = {
  title?: string
  items: string[]
}

export type PlaybookSection = {
  title: string
  intro?: string
  paragraphs?: string[]
  lists?: PlaybookListSection[]
}

export type PlaybookListItem = {
  slug: string
  name: string
  description: string
  tagline?: string
  lastUpdated?: string
  sections: PlaybookSection[]
  aliases?: string[]
}

const RAW_PLAYBOOKS: PlaybookListItem[] = [
  {
    slug: 'weekend-vol',
    name: 'Weekend Vol',
    description: 'Defined-risk approaches for harvesting or owning gamma over illiquid crypto weekends.',
    tagline: 'Capture the weekend volatility dislocation while keeping tail risk in check.',
    lastUpdated: '2024-10-01',
    sections: [
      {
        title: 'The Setup: Weekend Expirations',
        paragraphs: [
          'Friday PM entries ahead of the equity close often align with pockets of reduced liquidity and shifting implied volatility (IV) regimes as traditional desks wind down for the weekend.',
          'Sunday expirations are unique — flows are quieter, but crypto trades 24/7, so catalysts can still drop when traditional markets are offline.',
          'Always frame the trade against the short-dated volatility term structure. One to two day tenors can flip from steep to flat quickly depending on macro event risk.',
        ],
      },
      {
        title: 'Strategy Choice: Straddle/Strangle vs. Iron Condor',
        lists: [
          {
            title: 'Naked Straddle/Strangle',
            items: [
              'Pros: captures outsized moves if BTC breaks out unexpectedly.',
              'Cons: unlimited risk and muted theta decay if IV is already compressed heading into the weekend — you are short gamma into thin liquidity.',
              'Risk note: vulnerable to surprise catalysts (ETF headlines, regulatory actions) that can gap the market while books are shallow.',
            ],
          },
          {
            title: 'Iron Condor (risk-defined)',
            items: [
              'Pros: caps max loss while allowing you to harvest weekend theta more safely.',
              'Edge case: shines when Friday IV is elevated yet you expect mean reversion and range-bound price action through Sunday.',
              'Cons: smaller payoff if BTC makes a major move, which is acceptable when you are explicitly fading “surprise weekend fireworks.”',
              'Professional bias: defined-risk structures (iron condor/iron butterfly) dominate ultra-short dated flows because the asymmetric payoff of naked short gamma rarely compensates unless IV is obviously overpriced.',
            ],
          },
        ],
      },
      {
        title: 'Key Market KPIs to Watch',
        intro: 'Build conviction across these inputs before committing capital:',
        lists: [
          {
            title: 'Implied Volatility Surface',
            items: [
              'Compare Friday to Sunday expiries against the one-week bucket to detect weekend premium.',
              'If short-dated IV trades rich, shorting vol via condors/straddles can make sense; if it is cheap, avoid inheriting short gamma.',
            ],
          },
          {
            title: 'Spot & Derivatives Flows',
            items: [
              'Monitor perpetual funding rates (positive = long demand, negative = short demand).',
              'Read skew (25-delta risk reversals) for directional bias and asymmetric tail appetite.',
              'Map open interest clusters near key strikes to understand potential pinning zones.',
            ],
          },
          {
            title: 'Liquidity & Order Book Depth',
            items: [
              'Weekend books are thinner, so even modest flows can push price sharply.',
              'Thin liquidity favours risk-defined structures that cap loss if a gap occurs.',
            ],
          },
          {
            title: 'Macro Calendar / Event Risk',
            items: [
              'Audit regulatory announcements, ETF flows, and central-bank commentary that can hit between Friday close and Sunday reopen.',
              'Remember BTC reacts to macro headlines even when equities are shut, so gap risk is real.',
            ],
          },
        ],
      },
      {
        title: 'Putting It Together',
        paragraphs: [
          'If IV is elevated and you expect chop, lean into selling an iron condor around the expected weekend range.',
          'If IV is depressed but skew implies mispricing, consider directional defined-risk spreads (debit spreads) instead of naked short gamma.',
          'Expecting a volatility catalyst? Stay long optionality (straddles/strangles) even if premium feels expensive — protection beats complacency in gap-prone sessions.',
        ],
      },
    ],
    aliases: ['weekend-volatility', 'weekend-volatility-playbook'],
  },
]

const PLAYBOOK_BY_SLUG = new Map<string, PlaybookListItem>()

for (const playbook of RAW_PLAYBOOKS) {
  PLAYBOOK_BY_SLUG.set(playbook.slug, playbook)
  if (playbook.aliases) {
    for (const alias of playbook.aliases) {
      PLAYBOOK_BY_SLUG.set(alias, playbook)
    }
  }
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function getPlaybook(slug: string | null | undefined): PlaybookListItem | undefined {
  if (!slug) return undefined
  const direct = PLAYBOOK_BY_SLUG.get(slug)
  if (direct) return direct
  return PLAYBOOK_BY_SLUG.get(slugify(slug))
}

export function listPlaybooks(): PlaybookListItem[] {
  return RAW_PLAYBOOKS
}

export function usePlaybooks(): PlaybookListItem[] {
  const [playbooks] = React.useState(() => listPlaybooks())
  return playbooks
}
