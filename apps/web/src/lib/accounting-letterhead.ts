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
