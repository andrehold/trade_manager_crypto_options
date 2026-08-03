import React from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'

const QUESTIONS: { q: string; options: string[]; answer: number }[] = [
  { q: 'How many years have you actively traded options or comparable derivatives?', options: ['None', '< 1 year', '1–3 years', '3+ years'], answer: 3 },
  { q: 'Are you able to bear a total loss of the capital you deploy through this product?', options: ['No', 'Partially', 'Yes'], answer: 2 },
  { q: 'Do you understand how leverage, margin and short option positions can amplify losses?', options: ['No', 'Somewhat', 'Yes, fully'], answer: 2 },
  { q: 'Do you understand that this software is an execution tool and gives no investment advice?', options: ['No', 'Yes'], answer: 1 },
]

const ATTESTATIONS = [
  'I have assessed the appropriateness of this product for my own situation, based on my own answers above.',
  'I understand and accept the risk of losing the entire deployed capital.',
  'I retain sole responsibility for the investment decision and for regulatory compliance.',
]

export function AppropriatenessPage({ signed, onSign }: { signed: boolean; onSign: (payload: { answers: number[]; attestations: boolean[] }) => void }) {
  const [answers, setAnswers] = React.useState<number[]>(QUESTIONS.map((q) => q.answer))
  const [checked, setChecked] = React.useState<boolean[]>(ATTESTATIONS.map(() => false))
  const allAttested = checked.every(Boolean)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="type-title-l font-bold text-text-primary">Appropriateness</h1>
        {signed
          ? <span className="inline-flex items-center gap-1.5 rounded-full bg-status-success/15 px-2.5 py-1 type-caption font-semibold text-status-success"><Check className="h-3 w-3" />Completed &amp; signed</span>
          : <span className="rounded-full bg-bg-surface-2 px-2.5 py-1 type-caption text-text-tertiary">Not completed</span>}
      </div>

      <div className="rounded-2xl border border-dashed border-border-strong bg-bg-surface-1 p-4 type-caption text-text-secondary">
        <strong className="text-text-primary">This is your own assessment.</strong> The questions record <em>your</em> knowledge and circumstances. The software does not evaluate, score, or advise whether this product suits you, and produces no recommendation — the determination is yours alone.
      </div>

      <div className="rounded-2xl border border-border-default bg-bg-surface-1">
        <div className="px-5 py-2">
          {QUESTIONS.map((item, qi) => (
            <div key={qi} className="border-t border-border-default py-3.5 first:border-t-0">
              <div className="type-subhead text-text-primary">{item.q}</div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {item.options.map((opt, oi) => (
                  <button
                    key={oi} type="button"
                    onClick={() => setAnswers((a) => a.map((v, i) => (i === qi ? oi : v)))}
                    className={`rounded-lg border px-3 py-1.5 type-caption ${answers[qi] === oi ? 'border-accent-500/40 bg-accent-500/15 font-semibold text-accent-400' : 'border-border-strong bg-bg-surface-2 text-text-secondary hover:text-text-primary'}`}
                  >{opt}</button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="m-5 flex flex-col gap-3 rounded-xl border border-border-default bg-bg-surface-2 p-4">
          {ATTESTATIONS.map((text, i) => (
            <label key={i} className="flex items-start gap-2.5 type-subhead text-text-primary">
              <input
                type="checkbox" checked={checked[i]}
                onChange={() => setChecked((c) => c.map((v, j) => (j === i ? !v : v)))}
                className="mt-1 h-4 w-4 accent-accent-500"
              />
              <span>{text}</span>
            </label>
          ))}
          <div className="mt-1 flex items-center justify-between border-t border-border-default pt-3">
            <span className="font-mono type-caption text-text-tertiary">signed by R. Quandt · on completion</span>
            <Button variant="primary" size="sm" disabled={!allAttested} onClick={() => onSign({ answers, attestations: checked })}>Sign &amp; complete assessment</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
