import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { useState } from 'react'
import { cn } from '../lib/cn'
import { Icon } from './Icon'

export type { ColumnDef }

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[]
  data: T[]
  onRowClick?: (row: T) => void
  /** Sticky first column for IDs. */
  stickyFirst?: boolean
  className?: string
  dense?: boolean
}

export function DataTable<T>({
  columns,
  data,
  onRowClick,
  stickyFirst,
  className,
  dense,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const cellPad = dense ? 'px-md py-1.5' : 'px-md py-3'

  return (
    <div className={cn('custom-scrollbar overflow-x-auto', className)}>
      <table className="w-full border-collapse text-left">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-outline-variant bg-background">
              {hg.headers.map((header, i) => {
                const canSort = header.column.getCanSort()
                const sorted = header.column.getIsSorted()
                return (
                  <th
                    key={header.id}
                    onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    className={cn(
                      'px-md py-sm font-mono-tag text-label-md uppercase tracking-wide text-on-surface-variant',
                      canSort && 'cursor-pointer select-none hover:text-primary',
                      stickyFirst && i === 0 && 'sticky left-0 z-10 bg-background',
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {canSort && (
                        <Icon
                          name={sorted === 'asc' ? 'arrow_upward' : sorted === 'desc' ? 'arrow_downward' : 'unfold_more'}
                          size={14}
                          className={cn(!sorted && 'opacity-40')}
                        />
                      )}
                    </span>
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody className="text-body-sm">
          {table.getRowModel().rows.map((row, idx) => (
            <tr
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              className={cn(
                'border-b border-outline-variant transition-colors',
                idx % 2 === 1 && 'bg-background/40',
                onRowClick && 'cursor-pointer hover:bg-surface-container-low',
              )}
            >
              {row.getVisibleCells().map((cell, i) => (
                <td
                  key={cell.id}
                  className={cn(
                    cellPad,
                    'text-on-surface',
                    stickyFirst && i === 0 && 'sticky left-0 bg-surface-container-lowest font-bold text-primary',
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length === 0 && (
        <div className="py-10 text-center text-body-sm text-on-surface-variant">No records.</div>
      )}
    </div>
  )
}
