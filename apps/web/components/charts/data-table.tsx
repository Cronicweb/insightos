'use client';

import * as React from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import type { ChartSpec, TableColumnSpec } from '@/lib/types';
import { formatPct } from '@/lib/format';
import { DeltaPill, ShareBar } from '../ui/primitives';
import { colourAt, cn } from '@/lib/utils';

type Row = Record<string, unknown>;

const DASH = '\u2014';

/**
 * Sortable breakdown table driven entirely by the engine's column spec.
 * Cell rendering is chosen by declared column *type*, never by guessing at the
 * value - so a new engine chart works here with no frontend change.
 */
export function DataTable({ spec }: { spec: ChartSpec }) {
  const columns = (spec.encoding?.columns ?? []) as TableColumnSpec[];
  const data = spec.data as Row[];
  const [sorting, setSorting] = React.useState<SortingState>([]);

  const helper = createColumnHelper<Row>();

  const tableColumns = React.useMemo(
    () =>
      columns.map((c) =>
        helper.accessor((row) => row[c.key], {
          id: c.key,
          header: c.label,
          sortingFn: c.type === 'text' ? 'alphanumeric' : 'basic',
          cell: (info) => {
            const value = info.getValue();
            const row = info.row.original;
            switch (c.type) {
              case 'bar': {
                const pct = Number(value ?? 0);
                return (
                  <div className="flex items-center gap-2">
                    <span className="w-12 text-2xs tabular text-muted">{formatPct(pct, 2)}</span>
                    <ShareBar pct={pct} colour={colourAt(info.row.index)} />
                  </div>
                );
              }
              case 'delta':
                return (
                  <DeltaPill value={value === null || value === undefined ? null : Number(value)} />
                );
              case 'value':
                return (
                  <span className="tabular font-medium">{String(row.display ?? value ?? DASH)}</span>
                );
              case 'number':
                return <span className="tabular">{String(value ?? DASH)}</span>;
              default:
                return (
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: colourAt(info.row.index) }}
                    />
                    <span className="font-medium">{String(value ?? DASH)}</span>
                  </span>
                );
            }
          },
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spec.id],
  );

  const table = useReactTable({
    data,
    columns: tableColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-line">
              {hg.headers.map((header, i) => {
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    className={cn(
                      'whitespace-nowrap px-3 py-2 text-2xs font-semibold uppercase tracking-wide text-subtle',
                      columns[i]?.align === 'right' ? 'text-right' : 'text-left',
                    )}
                  >
                    <button
                      onClick={header.column.getToggleSortingHandler()}
                      className={cn(
                        'inline-flex items-center gap-1 hover:text-ink',
                        columns[i]?.align === 'right' && 'flex-row-reverse',
                      )}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sorted === 'asc' ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : sorted === 'desc' ? (
                        <ArrowDown className="h-3 w-3" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-35" />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-b border-line/70 last:border-0 hover:bg-elevated/60">
              {row.getVisibleCells().map((cell, i) => (
                <td
                  key={cell.id}
                  className={cn(
                    'whitespace-nowrap px-3 py-2.5',
                    columns[i]?.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
