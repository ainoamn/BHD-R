'use client';

import type { OpsColumnFilterKind, OpsColumnTableFilter } from '@/lib/ops-column-table';
import {
  opsColumnHasFilter,
  withOpsDateFilter,
  withOpsSelectFilter,
  withOpsTextFilter,
} from '@/lib/ops-column-table';

type SelectOption = { value: string; ar: string; en: string };

/**
 * Column header with ↕ sort menu + lens/calendar filter panel (shared across ops tables).
 */
export function OpsThFilterHeader({
  label,
  columnKey,
  kind,
  ar,
  filter,
  openKey,
  selectOptions,
  onOpenKey,
  onFilterChange,
}: {
  label: string;
  columnKey: string;
  kind: OpsColumnFilterKind;
  ar: boolean;
  filter: OpsColumnTableFilter;
  openKey: string | null;
  selectOptions?: SelectOption[];
  onOpenKey: (key: string | null) => void;
  onFilterChange: (next: OpsColumnTableFilter) => void;
}) {
  const filterable = kind !== 'none';
  const isDate = kind === 'date';
  const filterOpen = openKey === columnKey;
  const hasFilter = opsColumnHasFilter(filter, columnKey, kind);
  const sortedHere = filter.sortKey === columnKey;
  const dateRange = filter.dates[columnKey] ?? { from: '', to: '' };

  return (
    <th className={`ops-th-filter${hasFilter ? ' ops-th-filter--active' : ''}`}>
      <div className="ops-th-bar">
        <span className="ops-th-label">{label}</span>
        <span className="ops-th-tools">
          <details className="ops-th-sort" onClick={(event) => event.stopPropagation()}>
            <summary
              className={`ops-th-arrow${sortedHere ? ' is-on' : ''}`}
              aria-label={ar ? 'الفرز' : 'Sort'}
              title={ar ? 'الفرز' : 'Sort'}
              onClick={(event) => {
                const current = event.currentTarget.parentElement;
                const scope = current?.closest('thead') ?? document;
                scope.querySelectorAll('details.ops-th-sort[open]').forEach((el) => {
                  if (el !== current) el.removeAttribute('open');
                });
              }}
            >
              <span aria-hidden="true">
                {sortedHere ? (filter.sortDir === 'asc' ? '↑' : '↓') : '↕'}
              </span>
            </summary>
            <div className="ops-th-sort__menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className={sortedHere && filter.sortDir === 'asc' ? 'is-on' : undefined}
                onClick={(event) => {
                  event.currentTarget.closest('details.ops-th-sort')?.removeAttribute('open');
                  onFilterChange({ ...filter, sortKey: columnKey, sortDir: 'asc' });
                }}
              >
                {ar ? 'تصاعدي ↑' : 'Ascending ↑'}
              </button>
              <button
                type="button"
                role="menuitem"
                className={sortedHere && filter.sortDir === 'desc' ? 'is-on' : undefined}
                onClick={(event) => {
                  event.currentTarget.closest('details.ops-th-sort')?.removeAttribute('open');
                  onFilterChange({ ...filter, sortKey: columnKey, sortDir: 'desc' });
                }}
              >
                {ar ? 'تنازلي ↓' : 'Descending ↓'}
              </button>
            </div>
          </details>
          {filterable ? (
            <button
              type="button"
              className={`ops-th-tool${filterOpen || hasFilter ? ' is-on' : ''}`}
              aria-expanded={filterOpen}
              aria-label={
                isDate
                  ? ar
                    ? 'تصفية بالتاريخ'
                    : 'Filter by date'
                  : ar
                    ? 'بحث في العمود'
                    : 'Search column'
              }
              title={
                isDate
                  ? ar
                    ? 'تقويم — من/إلى'
                    : 'Calendar — from/to'
                  : ar
                    ? 'عدسة البحث'
                    : 'Search'
              }
              onClick={() => onOpenKey(filterOpen ? null : columnKey)}
            >
              {isDate ? '◷' : '⌕'}
            </button>
          ) : null}
        </span>
      </div>
      {filterable && filterOpen ? (
        <div className="ops-th-panel">
          {isDate ? (
            <div className="ops-th-dates">
              <label>
                <span>{ar ? 'من' : 'From'}</span>
                <input
                  type="date"
                  autoFocus
                  value={dateRange.from}
                  onChange={(event) =>
                    onFilterChange(
                      withOpsDateFilter(filter, columnKey, { from: event.target.value }),
                    )
                  }
                />
              </label>
              <label>
                <span>{ar ? 'إلى' : 'To'}</span>
                <input
                  type="date"
                  value={dateRange.to}
                  onChange={(event) =>
                    onFilterChange(withOpsDateFilter(filter, columnKey, { to: event.target.value }))
                  }
                />
              </label>
            </div>
          ) : kind === 'select' && selectOptions?.length ? (
            <select
              className="ops-th-select"
              aria-label={ar ? 'تصفية العمود' : 'Filter column'}
              autoFocus
              value={filter.select[columnKey] ?? ''}
              onChange={(event) =>
                onFilterChange(withOpsSelectFilter(filter, columnKey, event.target.value))
              }
            >
              <option value="">{ar ? 'الكل' : 'All'}</option>
              {selectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {ar ? option.ar : option.en}
                </option>
              ))}
            </select>
          ) : (
            <label className="ops-th-search">
              <span aria-hidden="true">⌕</span>
              <input
                autoFocus
                value={filter.text[columnKey] ?? ''}
                onChange={(event) =>
                  onFilterChange(withOpsTextFilter(filter, columnKey, event.target.value))
                }
                placeholder={ar ? 'بحث…' : 'Search…'}
              />
            </label>
          )}
        </div>
      ) : null}
    </th>
  );
}
