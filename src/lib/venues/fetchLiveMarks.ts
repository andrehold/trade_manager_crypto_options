import type { MarksMap } from '../../utils'
import { dbGetBest } from './deribit'

type ProgressCallback = (done: number, total: number, errors: number) => void

/**
 * Fetch live marks from Deribit for a list of unique instrument symbols.
 * Returns a MarksMap keyed by "deribit:<instrument>".
 */
export async function fetchDeribitMarks(
  instruments: string[],
  onProgress?: ProgressCallback,
): Promise<MarksMap> {
  const total = instruments.length
  if (total === 0) return {}

  onProgress?.(0, total, 0)

  const results: MarksMap = {}
  let done = 0
  let errors = 0
  const BATCH = 5

  for (let i = 0; i < total; i += BATCH) {
    const batch = instruments.slice(i, i + BATCH)
    const settled = await Promise.allSettled(
      batch.map(async (inst) => {
        const res = await dbGetBest(inst)
        return { inst, res }
      }),
    )

    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        const { inst, res } = outcome.value
        results[`deribit:${inst}`] = res
      } else {
        errors++
        console.error('[fetchDeribitMarks] failed', outcome.reason)
      }
      done++
    }

    onProgress?.(done, total, errors)
  }

  return results
}
