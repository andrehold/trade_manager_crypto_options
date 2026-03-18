import { TxnRow, Exchange, Position } from '../../utils'

export type ProcessedRowInfo = {
  row: TxnRow
  source: 'structure' | 'unprocessed_imports'
}

export type AssignLegsContext = {
  rows: TxnRow[]
  noImportRows: TxnRow[]
  processedRows: ProcessedRowInfo[]
  exchange: Exchange
  savedStructures: Position[]
  onConfirm: (rows: TxnRow[], unprocessedRows?: TxnRow[]) => void | Promise<void>
  onCancel: () => void
}

let store: AssignLegsContext | null = null

export const setAssignLegsContext = (ctx: AssignLegsContext) => {
  store = ctx
}

export const getAssignLegsContext = (): AssignLegsContext | null => store

export const clearAssignLegsContext = () => {
  store = null
}
