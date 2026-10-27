/** Client-side filter / sort / print helpers for the owner leasing ops table. */

export type LeasingColumnKey =
  | 'reference'
  | 'property'
  | 'unit'
  | 'owner'
  | 'tenant'
  | 'state'
  | 'startsOn'
  | 'endsOn'
  | 'rentMinor';

export type LeasingTableFilter = {
  reference: string;
  property: string;
  unit: string;
  owner: string;
  tenant: string;
  state: string;
  startsFrom: string;
  startsTo: string;
  endsFrom: string;
  endsTo: string;
  rent: string;
  sortKey: LeasingColumnKey;
  sortDir: 'asc' | 'desc';
};

export const EMPTY_LEASING_FILTER: LeasingTableFilter = {
  reference: '',
  property: '',
  unit: '',
  owner: '',
  tenant: '',
  state: '',
  startsFrom: '',
  startsTo: '',
  endsFrom: '',
  endsTo: '',
  rent: '',
  sortKey: 'startsOn',
  sortDir: 'desc',
};

const LEASING_INTRO_COLLAPSED_KEY = 'bhd-r.ops.leasing.intro-collapsed';

export function readLeasingIntroCollapsed(): boolean {
  try {
    return sessionStorage.getItem(LEASING_INTRO_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeLeasingIntroCollapsed(collapsed: boolean) {
  try {
    sessionStorage.setItem(LEASING_INTRO_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function includesInsensitive(haystack: string, needle: string): boolean {
  if (!needle.trim()) return true;
  return haystack.toLocaleLowerCase().includes(needle.trim().toLocaleLowerCase());
}

function dateOnly(value: unknown): string {
  const raw = text(value);
  return raw.slice(0, 10);
}

function inDateRange(value: unknown, from: string, to: string): boolean {
  const day = dateOnly(value);
  if (!from && !to) return true;
  if (!day) return false;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

export function leasingRowProperty(row: Record<string, unknown>, ar: boolean): string {
  return (
    (ar ? text(row.propertyNameAr) : text(row.propertyNameEn)) ||
    text(row.propertyNameAr) ||
    text(row.propertyNameEn) ||
    text(row.propertyId)
  );
}

export function leasingRowUnit(row: Record<string, unknown>, ar: boolean): string {
  return (
    text(row.unitCode) ||
    (ar ? text(row.unitNameAr) : text(row.unitNameEn)) ||
    text(row.unitNameAr) ||
    text(row.unitNameEn)
  );
}

export function leasingFilterActive(filter: LeasingTableFilter): boolean {
  return Boolean(
    filter.reference ||
      filter.property ||
      filter.unit ||
      filter.owner ||
      filter.tenant ||
      filter.state ||
      filter.startsFrom ||
      filter.startsTo ||
      filter.endsFrom ||
      filter.endsTo ||
      filter.rent,
  );
}

/** Whether a specific column currently has an active filter value. */
export function leasingColumnHasFilter(
  filter: LeasingTableFilter,
  key: LeasingColumnKey,
): boolean {
  switch (key) {
    case 'reference':
      return Boolean(filter.reference);
    case 'property':
      return Boolean(filter.property);
    case 'unit':
      return Boolean(filter.unit);
    case 'owner':
      return Boolean(filter.owner);
    case 'tenant':
      return Boolean(filter.tenant);
    case 'state':
      return Boolean(filter.state);
    case 'startsOn':
      return Boolean(filter.startsFrom || filter.startsTo);
    case 'endsOn':
      return Boolean(filter.endsFrom || filter.endsTo);
    case 'rentMinor':
      return Boolean(filter.rent);
    default:
      return false;
  }
}

export function leasingTextFilterValue(
  filter: LeasingTableFilter,
  key: LeasingColumnKey,
): string {
  switch (key) {
    case 'reference':
      return filter.reference;
    case 'property':
      return filter.property;
    case 'unit':
      return filter.unit;
    case 'owner':
      return filter.owner;
    case 'tenant':
      return filter.tenant;
    case 'rentMinor':
      return filter.rent;
    default:
      return '';
  }
}

export function withLeasingTextFilter(
  filter: LeasingTableFilter,
  key: LeasingColumnKey,
  value: string,
): LeasingTableFilter {
  switch (key) {
    case 'reference':
      return { ...filter, reference: value };
    case 'property':
      return { ...filter, property: value };
    case 'unit':
      return { ...filter, unit: value };
    case 'owner':
      return { ...filter, owner: value };
    case 'tenant':
      return { ...filter, tenant: value };
    case 'rentMinor':
      return { ...filter, rent: value };
    default:
      return filter;
  }
}

export function matchesLeasingColumnFilter(
  row: Record<string, unknown>,
  filter: LeasingTableFilter,
  ar: boolean,
): boolean {
  const property = leasingRowProperty(row, ar);
  const unit = leasingRowUnit(row, ar);
  const owner = text(row.ownerName);
  const tenant = text(row.tenantName);
  const reference = text(row.reference) || text(row.contractId) || text(row.id);
  const state = text(row.state) || text(row.status);
  const rent = text(row.rentMinor);

  if (!includesInsensitive(reference, filter.reference)) return false;
  if (!includesInsensitive(property, filter.property)) return false;
  if (!includesInsensitive(unit, filter.unit)) return false;
  if (!includesInsensitive(owner, filter.owner)) return false;
  if (!includesInsensitive(tenant, filter.tenant)) return false;
  if (filter.state && state !== filter.state) return false;
  if (!inDateRange(row.startsOn, filter.startsFrom, filter.startsTo)) return false;
  if (!inDateRange(row.endsOn, filter.endsFrom, filter.endsTo)) return false;
  if (filter.rent && !includesInsensitive(rent, filter.rent)) return false;
  return true;
}

function sortValue(
  row: Record<string, unknown>,
  key: LeasingColumnKey,
  ar: boolean,
): string | number {
  switch (key) {
    case 'reference':
      return text(row.reference) || text(row.contractId) || text(row.id);
    case 'property':
      return leasingRowProperty(row, ar);
    case 'unit':
      return leasingRowUnit(row, ar);
    case 'owner':
      return text(row.ownerName);
    case 'tenant':
      return text(row.tenantName);
    case 'state':
      return text(row.state) || text(row.status);
    case 'startsOn':
      return dateOnly(row.startsOn);
    case 'endsOn':
      return dateOnly(row.endsOn);
    case 'rentMinor': {
      const n = Number(row.rentMinor);
      return Number.isFinite(n) ? n : 0;
    }
    default:
      return '';
  }
}

export function sortLeasingRows<T extends Record<string, unknown>>(
  rows: T[],
  filter: LeasingTableFilter,
  ar: boolean,
): T[] {
  const dir = filter.sortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = sortValue(a, filter.sortKey, ar);
    const right = sortValue(b, filter.sortKey, ar);
    if (typeof left === 'number' && typeof right === 'number') {
      return (left - right) * dir;
    }
    return String(left).localeCompare(String(right), ar ? 'ar' : 'en', {
      numeric: true,
      sensitivity: 'base',
    }) * dir;
  });
}

export function toggleLeasingSort(
  filter: LeasingTableFilter,
  key: LeasingColumnKey,
): LeasingTableFilter {
  if (filter.sortKey === key) {
    return { ...filter, sortDir: filter.sortDir === 'asc' ? 'desc' : 'asc' };
  }
  return { ...filter, sortKey: key, sortDir: key === 'startsOn' || key === 'endsOn' ? 'desc' : 'asc' };
}

function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export type LeasingPrintRow = {
  reference: string;
  property: string;
  unit: string;
  owner: string;
  tenant: string;
  state: string;
  startsOn: string;
  endsOn: string;
  rent: string;
};

/** Opens a printable leasing report for the currently filtered rows. */
export function printLeasingReport(input: {
  ar: boolean;
  title: string;
  generatedAt: string;
  rows: LeasingPrintRow[];
}): boolean {
  const { ar, title, generatedAt, rows } = input;
  const headers = ar
    ? ['العقد', 'المبنى', 'الوحدة', 'المالك', 'المستأجر', 'الحالة', 'البداية', 'النهاية', 'الإيجار']
    : [
        'Contract',
        'Building',
        'Unit',
        'Owner',
        'Tenant',
        'Status',
        'Starts',
        'Ends',
        'Rent',
      ];
  const body = rows
    .map(
      (row) => `<tr>
<td dir="ltr">${esc(row.reference)}</td>
<td>${esc(row.property)}</td>
<td dir="ltr">${esc(row.unit)}</td>
<td>${esc(row.owner)}</td>
<td>${esc(row.tenant)}</td>
<td>${esc(row.state)}</td>
<td dir="ltr">${esc(row.startsOn)}</td>
<td dir="ltr">${esc(row.endsOn)}</td>
<td dir="ltr">${esc(row.rent)}</td>
</tr>`,
    )
    .join('');
  const html = `<!DOCTYPE html><html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}"><head>
<meta charset="utf-8"/><title>${esc(title)}</title>
<style>
body{font-family:Tahoma,Arial,sans-serif;margin:1.2rem;color:#122018}
h1{font-size:1.15rem;margin:0 0 .35rem}
p{margin:0 0 1rem;color:#4b5d55;font-size:.85rem}
table{width:100%;border-collapse:collapse;font-size:.78rem}
th,td{border:1px solid #c9d2cc;padding:.35rem .45rem;text-align:start;vertical-align:top}
th{background:#eef3f0}
@media print{body{margin:.6rem}}
</style></head><body>
<h1>${esc(title)}</h1>
<p>${esc(generatedAt)} · ${rows.length} ${ar ? 'سجل' : 'rows'}</p>
<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${body || `<tr><td colspan="9">${ar ? 'لا توجد نتائج' : 'No results'}</td></tr>`}</tbody></table>
<script>window.onload=()=>{window.print();}</script></body></html>`;
  const popup = window.open('', '_blank', 'noopener,noreferrer,width=1024,height=768');
  if (!popup) return false;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  return true;
}
