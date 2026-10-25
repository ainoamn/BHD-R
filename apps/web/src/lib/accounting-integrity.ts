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

/** Org bank account used for rent receipts and shown when cheques/transfers are due. */
export type AccountingBankAccount = {
  id: string;
  labelAr: string;
  labelEn: string;
  bankName: string;
  accountHolderName: string;
  /** Latin / English holder name (cheques and transfers). */
  accountHolderNameEn: string;
  iban: string;
  accountNumber: string;
  currency: string;
  active: boolean;
  /** Prefer this account when binding a new lease's rent receipts. */
  defaultForRent: boolean;
  /**
   * Properties that should auto-use this account on new leases.
   * Empty = org-wide (only via defaultForRent / manual pick).
   */
  propertyIds: string[];
  /** Optional GL cash/bank leaf created under Cash & Bank. */
  ledgerAccountId: string | null;
};

/** Prefer property-linked account, else the org default, else the first active. */
export function resolveRentBankAccount(
  accounts: AccountingBankAccount[] | null | undefined,
  propertyId: string | null | undefined,
): AccountingBankAccount | null {
  const active = (accounts ?? []).filter((row) => row.active);
  if (!active.length) return null;
  if (propertyId) {
    const linked = active.find((row) => row.propertyIds.includes(propertyId));
    if (linked) return linked;
  }
  return active.find((row) => row.defaultForRent) ?? active[0] ?? null;
}

export function bankAccountPayeeName(account: AccountingBankAccount, preferEn = true): string {
  const en = account.accountHolderNameEn.trim();
  const ar = account.accountHolderName.trim();
  if (preferEn) return en || ar;
  return ar || en;
}

export type AccountingSettings = {
  vatEnabled: boolean;
  vatRatePercent: number;
  otherTaxes: AccountingTaxRow[];
  baseCurrency: string;
  currencies: AccountingFxRate[];
  bankAccounts: AccountingBankAccount[];
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
  bankAccounts: [],
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
  const bankAccounts = Array.isArray(input.bankAccounts)
    ? input.bankAccounts
        .map((row) => {
          if (!row || typeof row !== 'object') return null;
          const item = row as Record<string, unknown>;
          const id = String(item.id ?? '')
            .trim()
            .slice(0, 64);
          const bankName = String(item.bankName ?? '')
            .trim()
            .slice(0, 160);
          const accountHolderName = String(item.accountHolderName ?? '')
            .trim()
            .slice(0, 160);
          if (!id || !bankName || !accountHolderName) return null;
          const currency = String(item.currency ?? base.baseCurrency)
            .trim()
            .toUpperCase()
            .slice(0, 3);
          const labelAr =
            String(item.labelAr ?? '')
              .trim()
              .slice(0, 120) || bankName;
          const labelEn =
            String(item.labelEn ?? '')
              .trim()
              .slice(0, 120) || labelAr;
          const propertyIds = Array.isArray(item.propertyIds)
            ? item.propertyIds
                .map((value) => String(value ?? '').trim().slice(0, 64))
                .filter((value) => /^[0-9a-f-]{36}$/i.test(value))
                .slice(0, 200)
            : [];
          return {
            id,
            labelAr,
            labelEn,
            bankName,
            accountHolderName,
            accountHolderNameEn: String(item.accountHolderNameEn ?? '')
              .trim()
              .slice(0, 160),
            iban: String(item.iban ?? '')
              .trim()
              .slice(0, 64),
            accountNumber: String(item.accountNumber ?? '')
              .trim()
              .slice(0, 64),
            currency: /^[A-Z]{3}$/.test(currency) ? currency : base.baseCurrency,
            active: item.active !== false,
            defaultForRent: Boolean(item.defaultForRent),
            propertyIds,
            ledgerAccountId:
              typeof item.ledgerAccountId === 'string' && item.ledgerAccountId.trim()
                ? item.ledgerAccountId.trim().slice(0, 64)
                : null,
          } satisfies AccountingBankAccount;
        })
        .filter((row): row is AccountingBankAccount => Boolean(row))
        .slice(0, 24)
    : base.bankAccounts;
  const defaultRentCount = bankAccounts.filter((row) => row.defaultForRent && row.active).length;
  const normalizedBanks =
    defaultRentCount <= 1
      ? bankAccounts
      : bankAccounts.map((row, index) => ({
          ...row,
          defaultForRent:
            row.defaultForRent &&
            index === bankAccounts.findIndex((entry) => entry.defaultForRent && entry.active),
        }));

  return {
    vatEnabled: input.vatEnabled !== false,
    vatRatePercent: vatRate,
    otherTaxes,
    baseCurrency: /^[A-Z]{3}$/.test(baseCurrency) ? baseCurrency : base.baseCurrency,
    currencies,
    bankAccounts: normalizedBanks,
    requireRefundConfirmForOnline: input.requireRefundConfirmForOnline !== false,
    requireSecondApproverForOnline: Boolean(input.requireSecondApproverForOnline),
    blockUnpostForLinked: input.blockUnpostForLinked !== false,
  };
}
