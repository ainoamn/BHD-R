/**
 * Lease contract terms (rent, VAT, municipality fee, other taxes, grace, deposit,
 * extra charges / discounts, payment and VAT cheque schedules).
 *
 * Shared by the manual lease form (live preview) and the server (authoritative
 * recomputation before the contract is stored). Money is integer minor units.
 */

export const LEASE_TERMS_VERSION = 1;

export const PAYMENT_METHODS = ['cheque', 'cash', 'bank_transfer'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_FREQUENCIES = [
  'monthly',
  'bimonthly',
  'quarterly',
  'semiannual',
  'annual',
] as const;
export type PaymentFrequency = (typeof PAYMENT_FREQUENCIES)[number];

export const FREQUENCY_MONTHS: Record<PaymentFrequency, number> = {
  monthly: 1,
  bimonthly: 2,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

export const VAT_MODES = ['with_rent', 'separate'] as const;
export type VatMode = (typeof VAT_MODES)[number];

export const ADJUSTMENT_KINDS = ['add', 'discount'] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export const ADJUSTMENT_RECURRENCES = [
  'one_time',
  'with_renewal',
  'every_3_months',
  'monthly',
] as const;
export type AdjustmentRecurrence = (typeof ADJUSTMENT_RECURRENCES)[number];

export const ADJUSTMENT_SCOPES = ['contract_end', 'one_year', 'custom_months'] as const;
export type AdjustmentScope = (typeof ADJUSTMENT_SCOPES)[number];

export const DEPOSIT_METHODS = ['cash', 'cheque', 'bank_transfer', 'other'] as const;
export type DepositMethod = (typeof DEPOSIT_METHODS)[number];

export const CONTRACT_USES = ['residential', 'commercial'] as const;
export type ContractUse = (typeof CONTRACT_USES)[number];

export const DEFAULT_VAT_RATE_PERCENT = '5';
export const MUNICIPALITY_FEE_BASIS_POINTS = 300;
export const MAX_SCHEDULE_ROWS = 240;

/* ------------------------------------------------------------------ dates */

const DAY_MS = 86_400_000;

function parts(iso: string): [number, number, number] {
  return [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))];
}

function toIso(year: number, month0: number, day: number): string {
  return new Date(Date.UTC(year, month0, day)).toISOString().slice(0, 10);
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month0, day] = parts(value);
  return toIso(year, month0, day) === value;
}

export function addDays(iso: string, days: number): string {
  const [year, month0, day] = parts(iso);
  return toIso(year, month0, day + days);
}

/** Same day-of-month N months later, clamped to the month end (Jan 31 + 1 → Feb 28/29). */
export function addMonths(iso: string, months: number): string {
  const [year, month0, day] = parts(iso);
  const target = new Date(Date.UTC(year, month0 + months, 1));
  const y = target.getUTCFullYear();
  const m = target.getUTCMonth();
  return toIso(y, m, Math.min(day, daysInMonth(y, m)));
}

export function daysBetween(fromIso: string, toIso_: string): number {
  const [ay, am, ad] = parts(fromIso);
  const [by, bm, bd] = parts(toIso_);
  return Math.round((Date.UTC(by, bm, bd) - Date.UTC(ay, am, ad)) / DAY_MS);
}

/** Last day of an N-month term: start + N months − 1 day. */
export function endDateForMonths(startsOn: string, months: number): string {
  return addDays(addMonths(startsOn, months), -1);
}

/** Whole months covered by [start, end] plus the extra days after the last whole month. */
export function contractPeriod(
  startsOn: string,
  endsOn: string,
): { months: number; extraDays: number } {
  if (endsOn < startsOn) return { months: 0, extraDays: 0 };
  let months = 0;
  while (months < 1200 && endDateForMonths(startsOn, months + 1) <= endsOn) months += 1;
  const boundary = addMonths(startsOn, months);
  const extraDays = endsOn >= boundary ? daysBetween(boundary, endsOn) + 1 : 0;
  return { months, extraDays };
}

/** The agreed payment day inside the month of `iso`, clamped to the month end. */
export function dueDateInMonth(iso: string, day: number): string {
  const [year, month0] = parts(iso);
  return toIso(year, month0, Math.min(Math.max(1, day), daysInMonth(year, month0)));
}

/** Rent-free days between unit handover and contract start. */
export function graceDaysBetween(handoverOn: string | null, startsOn: string): number {
  if (!handoverOn || handoverOn >= startsOn) return 0;
  return daysBetween(handoverOn, startsOn);
}

/* ------------------------------------------------------------------ money */

export function minorDigitsFor(currency: string): number {
  return ['OMR', 'BHD', 'KWD'].includes(currency) ? 3 : 2;
}

/** "1,250.5" → 1250500 (3 digits). Empty → 0. Invalid or too precise → null. */
export function parseMoney(value: string | null | undefined, digits: number): number | null {
  const trimmed = (value ?? '').trim().replace(/,/g, '');
  if (!trimmed) return 0;
  const match = /^(\d{1,12})(?:\.(\d+))?$/.exec(trimmed);
  if (!match) return null;
  const fraction = match[2] ?? '';
  if (fraction.length > digits) return null;
  return Number(match[1]! + fraction.padEnd(digits, '0'));
}

export function formatMinor(minor: number, digits: number): string {
  const sign = minor < 0 ? '-' : '';
  const padded = String(Math.abs(Math.round(minor))).padStart(digits + 1, '0');
  return digits
    ? `${sign}${padded.slice(0, -digits)}.${padded.slice(-digits)}`
    : `${sign}${padded}`;
}

/** "5" → 500 basis points, "2.5" → 250. Accepts 0–100 with up to two decimals. */
export function parsePercent(value: string | null | undefined): number | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return 0;
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bp <= 10_000 ? bp : null;
}

function applyRate(amountMinor: number, basisPoints: number): number {
  return Math.round((amountMinor * basisPoints) / 10_000);
}

/* ------------------------------------------------------------------ wire draft */

export type LeaseScheduleDraftRow = {
  dueOn: string;
  rent: string;
  chequeNumber?: string | undefined;
  bankName?: string | undefined;
};

export type LeaseAdjustmentDraft = {
  kind: AdjustmentKind;
  title: string;
  amount: string;
  recurrence: AdjustmentRecurrence;
  scope: AdjustmentScope;
  months?: string | undefined;
};

export type LeaseDepositItemDraft = {
  method: DepositMethod;
  amount: string;
  reference?: string | undefined;
  bankName?: string | undefined;
  dueOn?: string | undefined;
};

/** Form state as sent by the client: amounts are decimal strings in the unit currency. */
export type LeaseTermsDraft = {
  contractType: ContractUse;
  usageType: ContractUse;
  municipalFormNo?: string | undefined;
  municipalContractNo?: string | undefined;
  rentCalcMode: 'full' | 'per_meter';
  monthlyRent: string;
  rentAreaSqm?: string | undefined;
  rentPerSqm?: string | undefined;
  handoverOn?: string | undefined;
  startsOn: string;
  endsOn: string;
  paymentDay: string;
  paymentMethod: PaymentMethod;
  paymentFrequency: PaymentFrequency;
  vatEnabled: boolean;
  vatRate: string;
  vatMode: VatMode;
  vatChequeCount: string;
  municipalityFeeEnabled: boolean;
  registrationFee: string;
  otherTaxName?: string | undefined;
  otherTaxRate?: string | undefined;
  graceAsDiscount: boolean;
  deposit: string;
  depositItems: LeaseDepositItemDraft[];
  chequeBankName?: string | undefined;
  chequeAccountName?: string | undefined;
  schedule: LeaseScheduleDraftRow[];
  vatChequeNumbers: string[];
  adjustments: LeaseAdjustmentDraft[];
  electricityReading?: string | undefined;
  waterReading?: string | undefined;
  notes?: string | undefined;
};

/* ------------------------------------------------------------------ computed */

export type LeaseScheduleRow = {
  index: number;
  periodFrom: string | null;
  periodTo: string | null;
  dueOn: string;
  rentMinor: number;
  vatMinor: number;
  totalMinor: number;
  chequeNumber: string | null;
  bankName: string | null;
  extraDays: boolean;
};

export type LeaseVatCheque = {
  index: number;
  dueOn: string;
  amountMinor: number;
  chequeNumber: string | null;
};

export type LeaseAdjustmentLine = {
  kind: AdjustmentKind;
  title: string;
  amountMinor: number;
  recurrence: AdjustmentRecurrence;
  scope: AdjustmentScope;
  months: number | null;
  occurrences: number;
  lineTotalMinor: number;
};

export type LeaseDepositItem = {
  method: DepositMethod;
  amountMinor: number;
  reference: string | null;
  bankName: string | null;
  dueOn: string | null;
};

export type LeaseTotals = {
  rentMinor: number;
  monthlyVatMinor: number;
  monthlyRentInclVatMinor: number;
  vatMinor: number;
  municipalityFeeMinor: number;
  registrationFeeMinor: number;
  otherTaxMinor: number;
  additionsMinor: number;
  graceDiscountMinor: number;
  discountsMinor: number;
  totalDiscountsMinor: number;
  grandTotalMinor: number;
  depositMinor: number;
};

export type LeaseTerms = {
  version: typeof LEASE_TERMS_VERSION;
  currency: string;
  digits: number;
  contractType: ContractUse;
  usageType: ContractUse;
  municipalFormNo: string | null;
  municipalContractNo: string | null;
  rentCalcMode: 'full' | 'per_meter';
  rentAreaSqm: string | null;
  rentPerSqmMinor: number | null;
  monthlyRentMinor: number;
  handoverOn: string | null;
  startsOn: string;
  endsOn: string;
  months: number;
  extraDays: number;
  graceDays: number;
  graceAmountMinor: number;
  graceAsDiscount: boolean;
  paymentDay: number;
  paymentMethod: PaymentMethod;
  paymentFrequency: PaymentFrequency;
  vat: { enabled: boolean; rateBasisPoints: number; mode: VatMode; chequeCount: number };
  municipalityFee: { enabled: boolean; rateBasisPoints: number };
  otherTax: { name: string; rateBasisPoints: number } | null;
  chequeBankName: string | null;
  chequeAccountName: string | null;
  depositItems: LeaseDepositItem[];
  schedule: LeaseScheduleRow[];
  vatCheques: LeaseVatCheque[];
  adjustments: LeaseAdjustmentLine[];
  meters: { electricityReading: string | null; waterReading: string | null };
  notes: string | null;
  totals: LeaseTotals;
};

export type LeaseTermsError =
  | 'invalid_dates'
  | 'invalid_amount'
  | 'invalid_schedule'
  | 'invalid_terms'
  | 'duplicate_cheque_number';

export type LeaseTermsResult =
  { ok: true; terms: LeaseTerms } | { ok: false; error: LeaseTermsError };

/* ------------------------------------------------------------------ builders */

export type ScheduleBasis = {
  startsOn: string;
  endsOn: string;
  monthlyRentMinor: number;
  paymentDay: number;
  frequency: PaymentFrequency;
};

/** Default rent schedule: one row per payment period plus a prorated row for extra days. */
export function buildRentSchedule(basis: ScheduleBasis): Array<{
  periodFrom: string;
  periodTo: string;
  dueOn: string;
  rentMinor: number;
  extraDays: boolean;
}> {
  if (!isIsoDate(basis.startsOn) || !isIsoDate(basis.endsOn) || basis.endsOn < basis.startsOn) {
    return [];
  }
  const { months, extraDays } = contractPeriod(basis.startsOn, basis.endsOn);
  const step = FREQUENCY_MONTHS[basis.frequency];
  const rows: ReturnType<typeof buildRentSchedule> = [];
  for (let offset = 0; offset < months && rows.length < MAX_SCHEDULE_ROWS; offset += step) {
    const span = Math.min(step, months - offset);
    const periodFrom = addMonths(basis.startsOn, offset);
    const due = dueDateInMonth(periodFrom, basis.paymentDay);
    rows.push({
      periodFrom,
      periodTo: endDateForMonths(basis.startsOn, offset + span),
      dueOn: offset === 0 && due < basis.startsOn ? basis.startsOn : due,
      rentMinor: basis.monthlyRentMinor * span,
      extraDays: false,
    });
  }
  if (extraDays > 0) {
    const periodFrom = addMonths(basis.startsOn, months);
    const due = dueDateInMonth(periodFrom, basis.paymentDay);
    rows.push({
      periodFrom,
      periodTo: basis.endsOn,
      dueOn: due < periodFrom ? periodFrom : due,
      rentMinor: Math.round((basis.monthlyRentMinor / 30) * extraDays),
      extraDays: true,
    });
  }
  return rows;
}

/** VAT cheques split evenly over the term; the last cheque absorbs rounding. */
export function buildVatCheques(input: {
  startsOn: string;
  months: number;
  paymentDay: number;
  totalVatMinor: number;
  count: number;
}): Array<{ dueOn: string; amountMinor: number }> {
  const count = Math.max(1, Math.min(24, input.count));
  if (input.totalVatMinor <= 0) return [];
  const each = Math.floor(input.totalVatMinor / count);
  const span = Math.max(1, input.months);
  return Array.from({ length: count }, (_, index) => {
    const monthOffset = Math.floor((index * span) / count);
    const anchor = addMonths(input.startsOn, monthOffset);
    const due = dueDateInMonth(anchor, input.paymentDay);
    return {
      dueOn: index === 0 && due < input.startsOn ? input.startsOn : due,
      amountMinor: index === count - 1 ? input.totalVatMinor - each * (count - 1) : each,
    };
  });
}

/** Months an extra charge / discount applies for, by its scope. */
function adjustmentMonths(scope: AdjustmentScope, termMonths: number, custom: number | null) {
  const term = Math.max(1, termMonths);
  if (scope === 'one_year') return Math.min(12, term);
  if (scope === 'custom_months') return Math.min(Math.max(1, custom ?? 1), term);
  return term;
}

export function adjustmentOccurrences(
  recurrence: AdjustmentRecurrence,
  scope: AdjustmentScope,
  termMonths: number,
  customMonths: number | null,
): number {
  const months = adjustmentMonths(scope, termMonths, customMonths);
  switch (recurrence) {
    case 'one_time':
      return 1;
    case 'with_renewal':
      return 0;
    case 'every_3_months':
      return Math.ceil(months / 3);
    case 'monthly':
      return months;
  }
}

/** Auto-numbers cheques after the first: "000123" → "000124", "CHQ-9" → "CHQ-10". */
export function nextChequeNumber(previous: string, step: number): string {
  const match = /^(.*?)(\d+)$/.exec(previous.trim());
  if (!match) return '';
  const digits = match[2]!;
  const next = String(BigInt(digits) + BigInt(step));
  return `${match[1]}${next.padStart(digits.length, '0')}`;
}

/* ------------------------------------------------------------------ normalize + compute */

function text(value: string | null | undefined, max: number): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function wholeNumber(value: string | null | undefined, min: number, max: number): number | null {
  const trimmed = (value ?? '').trim();
  if (!/^\d{1,4}$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return parsed >= min && parsed <= max ? parsed : null;
}

/** Validates the draft and computes every derived amount. The server stores the result. */
export function computeLeaseTerms(
  draft: LeaseTermsDraft,
  currency: string,
  digits: number,
): LeaseTermsResult {
  const fail = (error: LeaseTermsError): LeaseTermsResult => ({ ok: false, error });

  if (!isIsoDate(draft.startsOn) || !isIsoDate(draft.endsOn) || draft.endsOn <= draft.startsOn) {
    return fail('invalid_dates');
  }
  const handoverOn = text(draft.handoverOn, 10);
  if (handoverOn && (!isIsoDate(handoverOn) || handoverOn > draft.startsOn)) {
    return fail('invalid_dates');
  }

  let monthlyRentMinor: number | null;
  let rentAreaSqm: string | null = null;
  let rentPerSqmMinor: number | null = null;
  if (draft.rentCalcMode === 'per_meter') {
    const area = (draft.rentAreaSqm ?? '').trim();
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(area)) return fail('invalid_amount');
    rentPerSqmMinor = parseMoney(draft.rentPerSqm, digits);
    if (rentPerSqmMinor === null) return fail('invalid_amount');
    rentAreaSqm = area;
    monthlyRentMinor = Math.round(Number(area) * rentPerSqmMinor);
  } else {
    monthlyRentMinor = parseMoney(draft.monthlyRent, digits);
  }
  if (monthlyRentMinor === null || monthlyRentMinor <= 0) return fail('invalid_amount');

  const paymentDay = wholeNumber(draft.paymentDay, 1, 31);
  const vatRate = parsePercent(draft.vatRate);
  const vatChequeCount = wholeNumber(draft.vatChequeCount, 1, 24) ?? 1;
  const registrationFeeMinor = parseMoney(draft.registrationFee, digits);
  const otherTaxRate = parsePercent(draft.otherTaxRate);
  const depositMinor = parseMoney(draft.deposit, digits);
  if (
    paymentDay === null ||
    vatRate === null ||
    otherTaxRate === null ||
    registrationFeeMinor === null ||
    depositMinor === null ||
    !(PAYMENT_METHODS as readonly string[]).includes(draft.paymentMethod) ||
    !(PAYMENT_FREQUENCIES as readonly string[]).includes(draft.paymentFrequency) ||
    !(VAT_MODES as readonly string[]).includes(draft.vatMode) ||
    !(CONTRACT_USES as readonly string[]).includes(draft.contractType) ||
    !(CONTRACT_USES as readonly string[]).includes(draft.usageType)
  ) {
    return fail('invalid_terms');
  }

  const { months, extraDays } = contractPeriod(draft.startsOn, draft.endsOn);
  const graceDays = graceDaysBetween(handoverOn, draft.startsOn);
  const graceAmountMinor = Math.round((monthlyRentMinor / 30) * graceDays);
  const vatEnabled = Boolean(draft.vatEnabled) && vatRate > 0;
  const vatWithRent = vatEnabled && draft.vatMode === 'with_rent';
  const isCheque = draft.paymentMethod === 'cheque';
  const chequeBankName = text(draft.chequeBankName, 160);

  if (!draft.schedule.length || draft.schedule.length > MAX_SCHEDULE_ROWS) {
    return fail('invalid_schedule');
  }
  const defaults = buildRentSchedule({
    startsOn: draft.startsOn,
    endsOn: draft.endsOn,
    monthlyRentMinor,
    paymentDay,
    frequency: draft.paymentFrequency,
  });
  const sameShape = defaults.length === draft.schedule.length;
  const schedule: LeaseScheduleRow[] = [];
  for (const [index, row] of draft.schedule.entries()) {
    const rentMinor = parseMoney(row.rent, digits);
    if (!isIsoDate(row.dueOn) || rentMinor === null) return fail('invalid_schedule');
    const vatMinor = vatWithRent ? applyRate(rentMinor, vatRate) : 0;
    const base = sameShape ? defaults[index] : undefined;
    schedule.push({
      index: index + 1,
      periodFrom: base?.periodFrom ?? null,
      periodTo: base?.periodTo ?? null,
      dueOn: row.dueOn,
      rentMinor,
      vatMinor,
      totalMinor: rentMinor + vatMinor,
      chequeNumber: isCheque ? text(row.chequeNumber, 80) : null,
      bankName: isCheque ? (text(row.bankName, 160) ?? chequeBankName) : null,
      extraDays: base?.extraDays ?? false,
    });
  }
  const rentTotal = schedule.reduce((sum, row) => sum + row.rentMinor, 0);
  if (rentTotal <= 0) return fail('invalid_schedule');

  let vatMinor = 0;
  let vatCheques: LeaseVatCheque[] = [];
  if (vatWithRent) {
    vatMinor = schedule.reduce((sum, row) => sum + row.vatMinor, 0);
  } else if (vatEnabled) {
    vatMinor = applyRate(rentTotal, vatRate);
    vatCheques = buildVatCheques({
      startsOn: draft.startsOn,
      months: months || 1,
      paymentDay,
      totalVatMinor: vatMinor,
      count: vatChequeCount,
    }).map((cheque, index) => ({
      index: index + 1,
      dueOn: cheque.dueOn,
      amountMinor: cheque.amountMinor,
      chequeNumber: text(draft.vatChequeNumbers[index], 80),
    }));
  }

  if (draft.adjustments.length > 50 || draft.depositItems.length > 20) return fail('invalid_terms');
  const adjustments: LeaseAdjustmentLine[] = [];
  for (const item of draft.adjustments) {
    const amountMinor = parseMoney(item.amount, digits);
    const title = text(item.title, 120);
    if (
      !title ||
      amountMinor === null ||
      amountMinor <= 0 ||
      !(ADJUSTMENT_KINDS as readonly string[]).includes(item.kind) ||
      !(ADJUSTMENT_RECURRENCES as readonly string[]).includes(item.recurrence) ||
      !(ADJUSTMENT_SCOPES as readonly string[]).includes(item.scope)
    ) {
      return fail('invalid_terms');
    }
    const customMonths = item.scope === 'custom_months' ? wholeNumber(item.months, 1, 240) : null;
    if (item.scope === 'custom_months' && customMonths === null) return fail('invalid_terms');
    const occurrences = adjustmentOccurrences(item.recurrence, item.scope, months, customMonths);
    adjustments.push({
      kind: item.kind,
      title,
      amountMinor,
      recurrence: item.recurrence,
      scope: item.scope,
      months: customMonths,
      occurrences,
      lineTotalMinor: amountMinor * occurrences,
    });
  }

  const depositItems: LeaseDepositItem[] = [];
  for (const item of draft.depositItems) {
    const amountMinor = parseMoney(item.amount, digits);
    const dueOn = text(item.dueOn, 10);
    if (
      amountMinor === null ||
      amountMinor <= 0 ||
      !(DEPOSIT_METHODS as readonly string[]).includes(item.method) ||
      (dueOn !== null && !isIsoDate(dueOn))
    ) {
      return fail('invalid_terms');
    }
    depositItems.push({
      method: item.method,
      amountMinor,
      reference: text(item.reference, 80),
      bankName: text(item.bankName, 160),
      dueOn,
    });
  }

  const chequeNumbers = [
    ...schedule.map((row) => row.chequeNumber),
    ...vatCheques.map((row) => row.chequeNumber),
    ...depositItems.filter((item) => item.method === 'cheque').map((item) => item.reference),
  ].filter((value): value is string => Boolean(value));
  if (new Set(chequeNumbers).size !== chequeNumbers.length) return fail('duplicate_cheque_number');

  const municipalityFeeMinor = draft.municipalityFeeEnabled
    ? applyRate(rentTotal, MUNICIPALITY_FEE_BASIS_POINTS)
    : 0;
  const otherTaxName = text(draft.otherTaxName, 80);
  const otherTax =
    otherTaxName && otherTaxRate > 0 ? { name: otherTaxName, rateBasisPoints: otherTaxRate } : null;
  const otherTaxMinor = otherTax ? applyRate(rentTotal, otherTax.rateBasisPoints) : 0;
  const additionsMinor = adjustments
    .filter((line) => line.kind === 'add')
    .reduce((sum, line) => sum + line.lineTotalMinor, 0);
  const discountsMinor = adjustments
    .filter((line) => line.kind === 'discount')
    .reduce((sum, line) => sum + line.lineTotalMinor, 0);
  const graceDiscountMinor = draft.graceAsDiscount ? graceAmountMinor : 0;
  const totalDiscountsMinor = graceDiscountMinor + discountsMinor;
  const grossMinor =
    rentTotal +
    vatMinor +
    municipalityFeeMinor +
    registrationFeeMinor +
    otherTaxMinor +
    additionsMinor;
  const monthlyVatMinor = vatEnabled ? applyRate(monthlyRentMinor, vatRate) : 0;

  return {
    ok: true,
    terms: {
      version: LEASE_TERMS_VERSION,
      currency,
      digits,
      contractType: draft.contractType,
      usageType: draft.usageType,
      municipalFormNo: text(draft.municipalFormNo, 80),
      municipalContractNo: text(draft.municipalContractNo, 80),
      rentCalcMode: draft.rentCalcMode === 'per_meter' ? 'per_meter' : 'full',
      rentAreaSqm,
      rentPerSqmMinor,
      monthlyRentMinor,
      handoverOn,
      startsOn: draft.startsOn,
      endsOn: draft.endsOn,
      months,
      extraDays,
      graceDays,
      graceAmountMinor,
      graceAsDiscount: Boolean(draft.graceAsDiscount),
      paymentDay,
      paymentMethod: draft.paymentMethod,
      paymentFrequency: draft.paymentFrequency,
      vat: {
        enabled: vatEnabled,
        rateBasisPoints: vatEnabled ? vatRate : 0,
        mode: draft.vatMode,
        chequeCount: vatEnabled && !vatWithRent ? vatChequeCount : 0,
      },
      municipalityFee: {
        enabled: Boolean(draft.municipalityFeeEnabled),
        rateBasisPoints: MUNICIPALITY_FEE_BASIS_POINTS,
      },
      otherTax,
      chequeBankName: isCheque ? chequeBankName : null,
      chequeAccountName: isCheque ? text(draft.chequeAccountName, 160) : null,
      depositItems,
      schedule,
      vatCheques,
      adjustments,
      meters: {
        electricityReading: text(draft.electricityReading, 40),
        waterReading: text(draft.waterReading, 40),
      },
      notes: text(draft.notes, 2000),
      totals: {
        rentMinor: rentTotal,
        monthlyVatMinor,
        monthlyRentInclVatMinor: monthlyRentMinor + (vatWithRent ? monthlyVatMinor : 0),
        vatMinor,
        municipalityFeeMinor,
        registrationFeeMinor,
        otherTaxMinor,
        additionsMinor,
        graceDiscountMinor,
        discountsMinor,
        totalDiscountsMinor,
        grandTotalMinor: Math.max(0, grossMinor - totalDiscountsMinor),
        depositMinor,
      },
    },
  };
}
