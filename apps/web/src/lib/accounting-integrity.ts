/** Shared accounting integrity rules (client + server). Posted books stay; reverse instead of erase. */

export const PROTECTED_JOURNAL_SOURCES = [
  'stay_payment',
  'rent_payment',
  'payment',
  'reservation_deposit',
  'stay_deposit_held',
  'expense',
  'invoice',
  'journal_reversal',
  'ops_purchase',
  'ops_sale',
  'cheque_clear',
] as const;

export type ProtectedJournalSource = (typeof PROTECTED_JOURNAL_SOURCES)[number];

export type AccountingTaxRow = {
  code: string;
  nameAr: string;
  nameEn: string;
  ratePercent: number;
};

export type AccountingFxRate = {
  code: string;
  /** Units of base currency per 1 unit of this currency (e.g. OMR per 1 USD). */
  rateToBase: string;
  minorUnit: number;
};

export type AccountingSettings = {
  vatEnabled: boolean;
  vatRatePercent: number;
  otherTaxes: AccountingTaxRow[];
  baseCurrency: string;
  currencies: AccountingFxRate[];
  /** Online / source-linked journals need an explicit refund confirmation before reverse. */
  requireRefundConfirmForOnline: boolean;
  /** Online reverse waits for a second approver (approval.decide). */
  requireSecondApproverForOnline: boolean;
  /** Block unpost for any linked source journal (manual drafts only). */
  blockUnpostForLinked: boolean;
};

export const DEFAULT_ACCOUNTING_SETTINGS: AccountingSettings = {
  vatEnabled: true,
  vatRatePercent: 5,
  otherTaxes: [],
  baseCurrency: 'OMR',
  currencies: [
    { code: 'USD', rateToBase: '0.385', minorUnit: 2 },
    { code: 'AED', rateToBase: '0.105', minorUnit: 2 },
    { code: 'EUR', rateToBase: '0.420', minorUnit: 2 },
  ],
  requireRefundConfirmForOnline: true,
  requireSecondApproverForOnline: false,
  blockUnpostForLinked: true,
};

export function isProtectedJournalSource(sourceType: string | null | undefined): boolean {
  if (!sourceType) return false;
  const key = sourceType.trim().toLowerCase();
  if (!key || key === 'manual') return false;
  return (PROTECTED_JOURNAL_SOURCES as readonly string[]).includes(key) || key.startsWith('ops_');
}

/** Only pure manual drafts may be unposted back out of the books. */
export function canUnpostJournalSource(sourceType: string | null | undefined): boolean {
  if (!sourceType) return true;
  const key = sourceType.trim().toLowerCase();
  return key === '' || key === 'manual';
}

export function normalizeAccountingSettings(raw: unknown): AccountingSettings {
  const base = { ...DEFAULT_ACCOUNTING_SETTINGS };
  if (!raw || typeof raw !== 'object') return base;
  const input = raw as Record<string, unknown>;
  const vatRate =
    typeof input.vatRatePercent === 'number' && Number.isFinite(input.vatRatePercent)
      ? Math.min(100, Math.max(0, input.vatRatePercent))
      : base.vatRatePercent;
  const otherTaxes = Array.isArray(input.otherTaxes)
    ? input.otherTaxes
        .map((row) => {
          if (!row || typeof row !== 'object') return null;
          const item = row as Record<string, unknown>;
          const code = String(item.code ?? '')
            .trim()
            .slice(0, 24)
            .toUpperCase();
          if (!code) return null;
          const rate =
            typeof item.ratePercent === 'number' && Number.isFinite(item.ratePercent)
              ? Math.min(100, Math.max(0, item.ratePercent))
              : 0;
          return {
            code,
            nameAr: String(item.nameAr ?? code).slice(0, 80),
            nameEn: String(item.nameEn ?? code).slice(0, 80),
            ratePercent: rate,
          } satisfies AccountingTaxRow;
        })
        .filter((row): row is AccountingTaxRow => Boolean(row))
        .slice(0, 12)
    : base.otherTaxes;
  const currencies = Array.isArray(input.currencies)
    ? input.currencies
        .map((row) => {
          if (!row || typeof row !== 'object') return null;
          const item = row as Record<string, unknown>;
          const code = String(item.code ?? '')
            .trim()
            .toUpperCase()
            .slice(0, 3);
          if (!/^[A-Z]{3}$/.test(code)) return null;
          const rateToBase = String(item.rateToBase ?? '')
            .trim()
            .slice(0, 24);
          if (!rateToBase || Number(rateToBase) <= 0) return null;
          const minorUnit =
            typeof item.minorUnit === 'number' && Number.isFinite(item.minorUnit)
              ? Math.min(6, Math.max(0, Math.floor(item.minorUnit)))
              : 2;
          return { code, rateToBase, minorUnit } satisfies AccountingFxRate;
        })
        .filter((row): row is AccountingFxRate => Boolean(row))
        .slice(0, 20)
    : base.currencies;
  const baseCurrency = String(input.baseCurrency ?? base.baseCurrency)
    .trim()
    .toUpperCase()
    .slice(0, 3);
  return {
    vatEnabled: input.vatEnabled !== false,
    vatRatePercent: vatRate,
    otherTaxes,
    baseCurrency: /^[A-Z]{3}$/.test(baseCurrency) ? baseCurrency : base.baseCurrency,
    currencies,
    requireRefundConfirmForOnline: input.requireRefundConfirmForOnline !== false,
    requireSecondApproverForOnline: Boolean(input.requireSecondApproverForOnline),
    blockUnpostForLinked: input.blockUnpostForLinked !== false,
  };
}
