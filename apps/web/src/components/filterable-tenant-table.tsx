'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { OpsThFilterHeader } from '@/components/ops-th-filter-header';
import {
  emptyOpsColumnFilter,
  matchesOpsColumnFilter,
  opsColumnFilterActive,
  sortOpsColumnRows,
  type OpsColumnFilterKind,
  type OpsColumnTableFilter,
} from '@/lib/ops-column-table';

export type TenantTableColumn = {
  key: string;
  label: string;
  kind?: OpsColumnFilterKind;
  selectOptions?: Array<{ value: string; ar: string; en: string }>;
};

export type TenantTableRow = {
  id: string;
  values: Record<string, string | number>;
  cells: ReactNode[];
};

/**
 * Tenant-facing data table with the same ↕ / ⌕ / ◷ column tools as owner ops tables.
 */
export function FilterableTenantTable({
  columns,
  rows,
  ar,
  empty,
  defaultSortKey = '',
}: {
  columns: TenantTableColumn[];
  rows: TenantTableRow[];
  ar: boolean;
  empty: string;
  defaultSortKey?: string;
}) {
  const [filter, setFilter] = useState<OpsColumnTableFilter>(() =>
    emptyOpsColumnFilter(defaultSortKey),
  );
  const [openKey, setOpenKey] = useState<string | null>(null);

  const visible = useMemo(() => {
    const columnDefs = columns.map((column) => ({
      key: column.key,
      format:
        column.kind === 'date'
          ? 'date'
          : column.kind === 'select'
            ? 'status'
            : column.kind === 'none'
              ? 'thumb'
              : undefined,
    }));
    const matched = rows.filter((row) =>
      matchesOpsColumnFilter(row.values, filter, columnDefs, (item, key) => item[key]),
    );
    return sortOpsColumnRows(
      matched,
      filter,
      ar ? 'ar' : 'en',
      (item, key) => item[key],
      (key) => {
        const kind = columns.find((column) => column.key === key)?.kind;
        if (kind === 'date') return 'date';
        return undefined;
      },
    );
  }, [rows, filter, columns, ar]);

  if (!rows.length) {
    return <p className="tenant-home__calm">{empty}</p>;
  }

  return (
    <div className="data-table-wrap tenant-table-wrap">
      {opsColumnFilterActive(filter) ? (
        <div className="tenant-table-filter-bar">
          <button
            type="button"
            className="button button--quiet button--sm"
            onClick={() => {
              setFilter(emptyOpsColumnFilter(defaultSortKey));
              setOpenKey(null);
            }}
          >
            {ar ? 'مسح التصفية' : 'Clear filters'}
          </button>
          <span className="ops-result-count">
            {visible.length} {ar ? 'نتيجة' : 'results'}
          </span>
        </div>
      ) : null}
      <table className="data-table data-table--stack tenant-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <OpsThFilterHeader
                key={column.key}
                label={column.label}
                columnKey={column.key}
                kind={column.kind ?? 'text'}
                ar={ar}
                filter={filter}
                openKey={openKey}
                {...(column.selectOptions ? { selectOptions: column.selectOptions } : {})}
                onOpenKey={setOpenKey}
                onFilterChange={setFilter}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.length ? (
            visible.map((row) => (
              <tr key={row.id}>
                {row.cells.map((cell, index) => {
                  const label = columns[index]?.label;
                  return (
                    <td key={`${row.id}-${index}`} {...(label ? { 'data-label': label } : {})}>
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length}>
                <p className="tenant-home__calm">
                  {ar ? 'لا نتائج مطابقة للتصفية.' : 'No rows match these filters.'}
                </p>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
