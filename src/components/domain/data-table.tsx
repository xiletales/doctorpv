"use client";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function DataTable<T>({
  data,
  columns,
  pageSize = 20,
  onRowClick,
  initialSort,
  rowKey,
}: {
  data: T[];
  // Column value types differ per column, which TanStack's own examples type the same way.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[];
  pageSize?: number;
  onRowClick?: (row: T) => void;
  initialSort?: SortingState;
  rowKey: (row: T) => string;
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSort ?? []);
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
    autoResetPageIndex: false,
    getRowId: rowKey,
  });
  const pages = table.getPageCount();

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-line">
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted();
                  return (
                    <th key={h.id} scope="col" aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined} className="px-4 py-2.5 text-left text-xs font-medium text-ink-3">
                      {h.column.getCanSort() ? (
                        <button type="button" onClick={h.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 hover:text-ink">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {sorted === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : sorted === "desc" ? <ArrowDown className="h-3 w-3" aria-hidden /> : null}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={cn("border-b border-line last:border-0", onRowClick && "cursor-pointer hover:bg-surface-2")}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-2.5 text-ink">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {data.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-ink-3">Tidak ada aset yang cocok dengan filter ini. Ubah filter untuk melihat lebih banyak.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-2 text-xs text-ink-3">
          <span>Halaman {table.getState().pagination.pageIndex + 1} dari {pages}</span>
          <Button size="icon" variant="ghost" aria-label="Halaman sebelumnya" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}><ChevronLeft className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" aria-label="Halaman berikutnya" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      ) : null}
    </div>
  );
}
