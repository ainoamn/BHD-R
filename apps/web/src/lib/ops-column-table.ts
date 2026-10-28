/** Shared per-column search / date / select / sort for operations tables. */

export type OpsColumnFilterKind = 'text' | 'date' | 'select' | 'none';

export type OpsColumnTableFilter = {
  text: Record<string, string>;
  dates: Record<string, { from: string; to: string }>;
  select: Record<string, string>;
  sortKey: string;
  sortDir: 'asc' | 'desc';
};

export const EMPTY_OPS_COLUMN_FILTER: OpsColumnTableFilter = {
  text: {},
  dates: {},
  select: {},
  sortKey: '',
  sortDir: 'asc',
};

export function emptyOpsColumnFilter(defaultSortKey = ''): OpsColumnTableFilter {
  return {
    ...EMPTY_OPS_COLUMN_FILTER,
    sortKey: defaultSortKey,
    sortDir:
      defaultSortKey.toLowerCase().includes('date') ||
      defaultSortKey.endsWith('On') ||
      defaultSortKey.endsWith('At')
        ? 'desc'
        : 'asc',
  };
}

export function opsColumnFilterKind(format?: string | undefined): OpsColumnFilterKind {
  if (format === 'thumb' || format === 'channels' || format === 'scopes') return 'none';
  if (format === 'date') return 'date';
  if (
    format === 'status' ||
    format === 'contract_state' ||
    format === 'term' ||
    format === 'usage' ||
    format === 'kind'
  ) {
    return 'select';
  }
  return 'text';
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function includesInsensitive(haystack: string, needle: string): boolean {
  if (!needle.trim()) return true;
  return haystack.toLocaleLowerCase().includes(needle.trim().toLocaleLowerCase());
}

function dateOnly(value: unknown): string {
  return textOf(value).slice(0, 10);
}

function inDateRange(value: unknown, from: string, to: string): boolean {
  const day = dateOnly(value);
  if (!from && !to) return true;
  if (!day) return false;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

export function opsColumnFilterActive(filter: OpsColumnTableFilter): boolean {
  return (
    Object.values(filter.text).some((value) => Boolean(value?.trim())) ||
    Object.values(filter.select).some((value) => Boolean(value)) ||
    Object.values(filter.dates).some((range) => Boolean(range?.from || range?.to))
  );
}

export function opsColumnHasFilter(
  filter: OpsColumnTableFilter,
  key: string,
  kind: OpsColumnFilterKind,
): boolean {
  if (kind === 'none') return false;
  if (kind === 'date') {
    const range = filter.dates[key];
    return Boolean(range?.from || range?.to);
  }
  if (kind === 'select') return Boolean(filter.select[key]);
  return Boolean(filter.text[key]?.trim());
}

export function matchesOpsColumnFilter(
  row: Record<string, unknown>,
  filter: OpsColumnTableFilter,
  columns: Array<{ key: string; format?: string | undefined }>,
  valueOf: (row: Record<string, unknown>, key: string) => unknown,
): boolean {
  for (const column of columns) {
    const kind = opsColumnFilterKind(column.format);
    if (kind === 'none') continue;
    const raw = valueOf(row, column.key);
    if (kind === 'date') {
      const range = filter.dates[column.key] ?? { from: '', to: '' };
      if (!inDateRange(raw, range.from, range.to)) return false;
      continue;
    }
    if (kind === 'select') {
      const wanted = filter.select[column.key] ?? '';
      if (wanted) {
        if (textOf(raw) !== wanted) return false;
        continue;
      }
      // No select options / empty select → allow text search on the same key.
    }
    const needle = filter.text[column.key] ?? '';
    if (!includesInsensitive(textOf(raw), needle)) return false;
  }
  return true;
}

export function sortOpsColumnRows<T extends Record<string, unknown>>(
  rows: T[],
  filter: OpsColumnTableFilter,
  locale: 'ar' | 'en',
  valueOf: (row: Record<string, unknown>, key: string) => unknown,
  formatOf?: (key: string) => string | undefined,
): T[] {
  if (!filter.sortKey) return rows;
  const dir = filter.sortDir === 'asc' ? 1 : -1;
  const format = formatOf?.(filter.sortKey);
  return [...rows].sort((a, b) => {
    const leftRaw = valueOf(a, filter.sortKey);
    const rightRaw = valueOf(b, filter.sortKey);
    if (format === 'money' || format === 'count') {
      const left = Number(leftRaw);
      const right = Number(rightRaw);
      const leftN = Number.isFinite(left) ? left : 0;
      const rightN = Number.isFinite(right) ? right : 0;
      return (leftN - rightN) * dir;
    }
    if (format === 'date') {
      return dateOnly(leftRaw).localeCompare(dateOnly(rightRaw)) * dir;
    }
    return (
      textOf(leftRaw).localeCompare(textOf(rightRaw), locale === 'ar' ? 'ar' : 'en', {
        numeric: true,
        sensitivity: 'base',
      }) * dir
    );
  });
}

export function withOpsTextFilter(
  filter: OpsColumnTableFilter,
  key: string,
  value: string,
): OpsColumnTableFilter {
  return { ...filter, text: { ...filter.text, [key]: value } };
}

export function withOpsSelectFilter(
  filter: OpsColumnTableFilter,
  key: string,
  value: string,
): OpsColumnTableFilter {
  return { ...filter, select: { ...filter.select, [key]: value } };
}

export function withOpsDateFilter(
  filter: OpsColumnTableFilter,
  key: string,
  patch: Partial<{ from: string; to: string }>,
): OpsColumnTableFilter {
  const current = filter.dates[key] ?? { from: '', to: '' };
  return {
    ...filter,
    dates: { ...filter.dates, [key]: { ...current, ...patch } },
  };
}
