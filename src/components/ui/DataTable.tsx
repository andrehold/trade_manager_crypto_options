import React from 'react'

export type ColumnAlign = 'left' | 'right'

export interface Column<T> {
  key: string
  header: React.ReactNode
  align?: ColumnAlign
  /** Render the cell content. Receives the row item. */
  render: (row: T) => React.ReactNode
  /** If true, cell uses font-mono tabular-nums for numeric values */
  mono?: boolean
  /** Optional abbr tooltip for short header labels like greek symbols */
  headerAbbr?: string
  /** Extra className applied to both th and td */
  className?: string
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  rowKey: (row: T, index: number) => string
  /** Optional empty state message */
  emptyMessage?: string
  /** Optional sort header render — if provided, wraps header content */
  className?: string
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  emptyMessage = 'No data.',
  className,
}: DataTableProps<T>) {
  return (
    <div className="overflow-x-auto">
      <table className={`min-w-full type-subhead ${className ?? ''}`}>
        <thead className="bg-bg-surface-1-alpha">
          <tr>
            {columns.map((col) => {
              const alignClass = col.align === 'right' ? 'text-right' : ''
              const headerContent = col.headerAbbr ? (
                <abbr title={col.headerAbbr} className="cursor-help no-underline">
                  {col.header}
                </abbr>
              ) : (
                col.header
              )
              return (
                <th key={col.key} className={`tbl-th ${alignClass} ${col.className ?? ''}`}>
                  {headerContent}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="tbl-td text-muted type-subhead">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, i) => (
              <tr key={rowKey(row, i)} className="tbl-row">
                {columns.map((col) => {
                  const alignClass = col.align === 'right' ? 'text-right' : ''
                  const monoClass = col.mono ? 'font-mono tabular-nums' : ''
                  return (
                    <td key={col.key} className={`tbl-td ${alignClass} ${monoClass} ${col.className ?? ''}`}>
                      {col.render(row)}
                    </td>
                  )
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
