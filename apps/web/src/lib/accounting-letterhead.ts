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

/** Public letterheaded view the client opens from email / WhatsApp / QR. */
export function accountingSharePath(locale: 'ar' | 'en', token: string): string {
  return `/${locale}/verify/accounting/${encodeURIComponent(token)}`;
}

/**
 * Safe back target for the print toolbar: the hub URL the user came from, or the tab that
 * matches the printed kind (documents / journal / reports) instead of the dashboard.
 * Always attaches focus/open for the printed id so the hub can highlight that row.
 */
export function accountingPrintBackHref(
  kind: AccountingPrintKind,
  id: string,
  from?: string | null,
): string {
  const raw = (from ?? '').trim().slice(0, 512);
  const href =
    raw.startsWith('/owner/accounting') &&
    !raw.startsWith('//') &&
    !/^[a-z][a-z0-9+.-]*:/i.test(raw)
      ? raw
      : kind === 'document'
        ? '/owner/accounting?tab=documents'
        : kind === 'journal'
          ? '/owner/accounting?tab=journal'
          : kind === 'report'
            ? '/owner/accounting?tab=reports'
            : '/owner/accounting';

  if (!/^[0-9a-f-]{36}$/i.test(id)) return href;

  const qIndex = href.indexOf('?');
  const path = qIndex >= 0 ? href.slice(0, qIndex) : href;
  const params = new URLSearchParams(qIndex >= 0 ? href.slice(qIndex + 1) : '');
  if (kind === 'document') {
    if (!params.get('tab')) params.set('tab', 'documents');
    params.set('focus', id);
  } else if (kind === 'journal') {
    if (!params.get('tab')) params.set('tab', 'journal');
    params.set('open', id);
    params.set('focus', id);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
