import type { ColumnMapping } from '../../components/ColumnMapper'

export type ColumnMapperContext = {
  headers: string[]
  mode: 'import' | 'backfill'
  onConfirm: (mapping: ColumnMapping) => void
  onCancel: () => void
}

let store: ColumnMapperContext | null = null

export const setColumnMapperContext = (ctx: ColumnMapperContext) => {
  store = ctx
}

export const getColumnMapperContext = (): ColumnMapperContext | null => store

export const clearColumnMapperContext = () => {
  store = null
}
