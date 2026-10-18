export type AccountingPrintKind = 'journal' | 'document' | 'report';

export type AccountingIssuer = {
  nameAr: string;
  nameEn: string;
  logoDataUrl: string | null;
  phone: string;
  email: string;
  registrationNumber: string;
};

export type AccountingSignature = {
  fingerprint: string;
  code: string;
  signedAt: string;
  verifyUrl: string;
  qrSvg: string;
};

export type AccountingPrintLine = {
  account: string;
  dimension: string;
  memo: string;
  debit: string;
  credit: string;
};

export type AccountingPrintDoc = {
  kind: AccountingPrintKind;
  number: string;
  titleAr: string;
  titleEn: string;
  status: string;
  occurredOn: string;
  description: string;
  amountText: string;
  currency: string;
  partyName: string | null;
  propertyLabel: string | null;
  issuer: AccountingIssuer;
  lines: AccountingPrintLine[];
  meta: Array<{ labelAr: string; labelEn: string; value: string }>;
  signature: AccountingSignature;
  issuedAt: string;
};

export function accountingPrintPath(
  locale: 'ar' | 'en',
  kind: AccountingPrintKind,
  id: string,
  extra?: Record<string, string>,
): string {
  const params = new URLSearchParams({ kind, id, ...(extra ?? {}) });
  return `/${locale}/owner/accounting/print?${params.toString()}`;
}

/**
 * Safe back target for the print toolbar: the hub URL the user came from, or the tab that
 * matches the printed kind (documents / journal / reports) instead of the dashboard.
 */
export function accountingPrintBackHref(
  kind: AccountingPrintKind,
  id: string,
  from?: string | null,
): string {
  const raw = (from ?? '').trim().slice(0, 512);
  if (
    raw.startsWith('/owner/accounting') &&
    !raw.startsWith('//') &&
    !/^[a-z][a-z0-9+.-]*:/i.test(raw)
  ) {
    return raw;
  }
  const open = /^[0-9a-f-]{36}$/i.test(id) ? `&open=${encodeURIComponent(id)}` : '';
  if (kind === 'document') return `/owner/accounting?tab=documents${open}`;
  if (kind === 'journal') return `/owner/accounting?tab=journal${open}`;
  if (kind === 'report') return '/owner/accounting?tab=reports';
  return '/owner/accounting';
}
