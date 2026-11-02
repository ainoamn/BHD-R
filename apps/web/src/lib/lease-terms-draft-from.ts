import type { HandoverAfterSign } from '@/lib/approval-policy';
import {
  DEFAULT_VAT_RATE_PERCENT,
  LEASE_TERMS_VERSION,
  addDays,
  addMonths,
  buildRentSchedule,
  contractPeriod,
  endDateForMonths,
  formatMinor,
  minorDigitsFor,
  parseMoney,
  type ContractUse,
  type LeaseAdjustmentDraft,
  type LeaseTerms,
  type LeaseTermsDraft,
  type PaymentFrequency,
  type PaymentMethod,
} from '@/lib/lease-terms';

/** Calendar date in Asia/Muscat (YYYY-MM-DD). */
export function muscatTodayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat' }).format(new Date());
}

/** Muscat calendar date for an absolute instant. */
export function muscatDateIso(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat' }).format(at);
}

/** Handover calendar date from approval/issue time per owner settings. */
export function computeHandoverOnAfterSign(from: Date, delay: HandoverAfterSign): string {
  const base = muscatDateIso(from);
  switch (delay) {
    case 'hour':
      return muscatDateIso(new Date(from.getTime() + 60 * 60 * 1000));
    case 'day':
      return addDays(base, 1);
    case 'week':
      return addDays(base, 7);
    case 'month':
      return addMonths(base, 1);
  }
}

/**
 * Shift handover + lease start (and rebuild end/schedule) from the owner’s
 * post-approval handover delay. Keeps the same term length when possible.
 */
export function applyHandoverAfterSignToDraft(
  draft: LeaseTermsDraft,
  delay: HandoverAfterSign,
  options: { from?: Date; currency?: string } = {},
): LeaseTermsDraft {
  const from = options.from ?? new Date();
  const digits = minorDigitsFor(options.currency ?? 'OMR');
  const handoverOn = computeHandoverOnAfterSign(from, delay);
  const startsOn = handoverOn;
  const prior =
    draft.startsOn && draft.endsOn && draft.startsOn <= draft.endsOn
      ? contractPeriod(draft.startsOn, draft.endsOn)
      : null;
  const months = prior && prior.months > 0 ? prior.months : 12;
  const endsOn = endDateForMonths(startsOn, months);
  const paymentDay = Number(draft.paymentDay) || 5;
  const rentMinor = parseMoney(draft.monthlyRent, digits) ?? 0;
  const schedule = buildRentSchedule({
    startsOn,
    endsOn,
    monthlyRentMinor: rentMinor,
    paymentDay,
    frequency: draft.paymentFrequency || 'monthly',
  });
  const moneyRow = (minor: number) => formatMinor(minor, digits).replace(/\.?0+$/, '');
  return {
    ...draft,
    handoverOn,
    startsOn,
    endsOn,
    schedule: schedule.map((row, index) => ({
      dueOn: row.dueOn,
      rent: moneyRow(row.rentMinor),
      chequeNumber: draft.schedule[index]?.chequeNumber ?? '',
      bankName: draft.schedule[index]?.bankName ?? draft.chequeBankName ?? '',
    })),
  };
}

export type BookingLeaseTermsSeedInput = {
  currency: string;
  rentMinor: string | null | undefined;
  depositMinor: string | null | undefined;
  contractType: ContractUse | null | undefined;
  termMonths: number | null | undefined;
  areaSquareMeters?: string | null | undefined;
  /** Contract signing day; handover defaults to the next calendar day. */
  signedOn?: string | null | undefined;
  bank?: {
    id: string;
    bankName: string;
    accountHolderName: string;
  } | null;
};

/**
 * Prefill a lease draft from a website booking: usage/type and term the client chose,
 * rent/deposit from the unit/arabon, handover = signing day + 1, start = handover.
 */
export function buildBookingLeaseTermsDraft(input: BookingLeaseTermsSeedInput): LeaseTermsDraft {
  const digits = minorDigitsFor(input.currency);
  const signedOn =
    input.signedOn && /^\d{4}-\d{2}-\d{2}$/.test(input.signedOn)
      ? input.signedOn
      : muscatTodayIso();
  const handoverOn = addDays(signedOn, 1);
  const startsOn = handoverOn;
  const months =
    input.termMonths && input.termMonths > 0 && input.termMonths <= 120 ? input.termMonths : 12;
  const endsOn = endDateForMonths(startsOn, months);
  const use: ContractUse | '' =
    input.contractType === 'commercial' || input.contractType === 'residential'
      ? input.contractType
      : '';
  const rent = input.rentMinor ? money(Number(input.rentMinor), digits) : '';
  const deposit = input.depositMinor
    ? money(Number(input.depositMinor), digits)
    : rent;
  const paymentDay = '5';
  const paymentFrequency: PaymentFrequency = 'monthly';
  const bank = input.bank;
  // Match the booking form default; bank payee binds when org accounts load.
  const paymentMethod: PaymentMethod = 'cheque';
  const schedule = buildRentSchedule({
    startsOn,
    endsOn,
    monthlyRentMinor: Number(input.rentMinor) || 0,
    paymentDay: Number(paymentDay),
    frequency: paymentFrequency,
  });
  return {
    contractType: use,
    usageType: use,
    municipalFormNo: '',
    municipalContractNo: '',
    rentCalcMode: 'full',
    monthlyRent: rent,
    rentAreaSqm: input.areaSquareMeters ?? '',
    rentPerSqm: '',
    handoverOn,
    startsOn,
    endsOn,
    paymentDay,
    paymentMethod,
    paymentFrequency,
    vatEnabled: false,
    vatRate: DEFAULT_VAT_RATE_PERCENT,
    vatMode: 'with_rent',
    vatChequeCount: '1',
    municipalityFeeEnabled: true,
    municipalityFeePayer: 'owner',
    registrationFee: '1',
    otherTaxName: '',
    otherTaxRate: '',
    graceAsDiscount: true,
    deposit,
    depositItems: deposit
      ? [
          {
            method: 'cheque',
            amount: deposit,
            reference: '',
            bankName: bank?.bankName ?? '',
            dueOn: '',
          },
        ]
      : [],
    chequeBankName: bank?.bankName ?? '',
    chequeAccountName: bank?.accountHolderName ?? '',
    rentBankAccountId: bank?.id ?? '',
    schedule: schedule.map((row) => ({
      dueOn: row.dueOn,
      rent: money(row.rentMinor, digits),
      chequeNumber: '',
      bankName: bank?.bankName ?? '',
    })),
    vatChequeNumbers: [],
    adjustments: [],
    electricityReading: '',
    waterReading: '',
    notes: '',
  };
}

function money(minor: number, digits: number): string {
  return formatMinor(minor, digits).replace(/\.?0+$/, '');
}

function percentFromBasisPoints(bp: number): string {
  if (!Number.isFinite(bp) || bp <= 0) return DEFAULT_VAT_RATE_PERCENT;
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  if (!frac) return String(whole);
  return `${whole}.${String(frac).padStart(2, '0').replace(/0+$/, '')}`;
}

function isLeaseTerms(value: unknown): value is LeaseTerms {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    row.version === LEASE_TERMS_VERSION &&
    typeof row.monthlyRentMinor === 'number' &&
    typeof row.startsOn === 'string' &&
    typeof row.endsOn === 'string'
  );
}

function isLeaseTermsDraft(value: unknown): value is LeaseTermsDraft {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.monthlyRent === 'string' && typeof row.startsOn === 'string';
}

/** Convert a stored computed LeaseTerms blob back into editable form draft. */
export function leaseTermsToDraft(terms: LeaseTerms): LeaseTermsDraft {
  const digits = terms.digits;
  return {
    contractType: terms.contractType,
    usageType: terms.usageType,
    municipalFormNo: terms.municipalFormNo ?? '',
    municipalContractNo: terms.municipalContractNo ?? '',
    rentCalcMode: terms.rentCalcMode,
    monthlyRent: money(terms.monthlyRentMinor, digits),
    rentAreaSqm: terms.rentAreaSqm ?? '',
    rentPerSqm: terms.rentPerSqmMinor != null ? money(terms.rentPerSqmMinor, digits) : '',
    handoverOn: terms.handoverOn ?? '',
    startsOn: terms.startsOn,
    endsOn: terms.endsOn,
    paymentDay: String(terms.paymentDay),
    paymentMethod: terms.paymentMethod,
    paymentFrequency: terms.paymentFrequency,
    vatEnabled: terms.vat.enabled,
    vatRate: percentFromBasisPoints(terms.vat.rateBasisPoints),
    vatMode: terms.vat.mode,
    vatChequeCount: String(Math.max(1, terms.vat.chequeCount || 1)),
    municipalityFeeEnabled: terms.municipalityFee.enabled,
    municipalityFeePayer: terms.municipalityFee.payer,
    registrationFee: money(terms.totals.registrationFeeMinor, digits),
    otherTaxName: terms.otherTax?.name ?? '',
    otherTaxRate: terms.otherTax ? percentFromBasisPoints(terms.otherTax.rateBasisPoints) : '',
    graceAsDiscount: terms.graceAsDiscount,
    deposit: money(terms.totals.depositMinor, digits),
    depositItems: terms.depositItems.map((item) => ({
      method: item.method,
      amount: money(item.amountMinor, digits),
      reference: item.reference ?? '',
      bankName: item.bankName ?? '',
      dueOn: item.dueOn ?? '',
    })),
    chequeBankName: terms.chequeBankName ?? '',
    chequeAccountName: terms.chequeAccountName ?? '',
    rentBankAccountId: terms.rentBankAccountId ?? '',
    schedule: terms.schedule.map((row) => ({
      dueOn: row.dueOn,
      rent: money(row.rentMinor, digits),
      chequeNumber: row.chequeNumber ?? '',
      bankName: row.bankName ?? '',
    })),
    vatChequeNumbers: terms.vatCheques.map((row) => row.chequeNumber ?? ''),
    adjustments: terms.adjustments.map((line): LeaseAdjustmentDraft => ({
      kind: line.kind,
      title: line.title,
      amount: money(line.amountMinor, digits),
      recurrence: line.recurrence,
      scope: line.scope,
      months: line.months != null ? String(line.months) : '',
    })),
    electricityReading: terms.meters.electricityReading ?? '',
    waterReading: terms.meters.waterReading ?? '',
    notes: terms.notes ?? '',
  };
}

export type RenewalSeedInput = {
  currency: string;
  renewalStartsOn: string;
  months?: number;
  rentMinor: string;
  depositMinor: string | null;
  billingDay: number;
  leaseTermsRaw: unknown;
  fallbackAdjustments?: ReadonlyArray<{
    kind: 'add' | 'discount';
    title: string;
    amountMinor: string;
  }>;
  fallbackPaymentMethod?: PaymentMethod | null;
  fallbackPaymentFrequency?: PaymentFrequency | null;
  fallbackVatEnabled?: boolean | null;
  fallbackContractType?: ContractUse | '';
  fallbackChequeBankName?: string | null;
  fallbackChequeAccountName?: string | null;
  fallbackRentBankAccountId?: string | null;
};

export type RenewalPreviousMeters = {
  electricityReading?: string | undefined;
  waterReading?: string | undefined;
  electricityReadingPhoto?: string | undefined;
  waterReadingPhoto?: string | undefined;
};

export type RenewalTermsSeed = {
  draft: LeaseTermsDraft;
  previousMeters: RenewalPreviousMeters;
};

function metersFromRaw(raw: unknown): RenewalPreviousMeters {
  if (!raw || typeof raw !== 'object') return {};
  if (isLeaseTerms(raw)) {
    return {
      electricityReading: raw.meters.electricityReading ?? undefined,
      waterReading: raw.meters.waterReading ?? undefined,
    };
  }
  if (isLeaseTermsDraft(raw)) {
    return {
      electricityReading: raw.electricityReading || undefined,
      waterReading: raw.waterReading || undefined,
      electricityReadingPhoto: raw.electricityReadingPhoto || undefined,
      waterReadingPhoto: raw.waterReadingPhoto || undefined,
    };
  }
  const row = raw as Record<string, unknown>;
  const meters =
    row.meters && typeof row.meters === 'object' ? (row.meters as Record<string, unknown>) : row;
  const text = (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined;
  return {
    electricityReading: text(meters.electricityReading),
    waterReading: text(meters.waterReading),
    electricityReadingPhoto: text(meters.electricityReadingPhoto),
    waterReadingPhoto: text(meters.waterReadingPhoto),
  };
}

/**
 * Build renewal form draft from the previous contract:
 * carry VAT, extras, deposit, payee — shift dates to the new period.
 */
export function buildRenewalTermsDraft(input: RenewalSeedInput): RenewalTermsSeed {
  const digits = minorDigitsFor(input.currency);
  const months = input.months && input.months > 0 ? input.months : 12;
  const startsOn = input.renewalStartsOn;
  const endsOn = endDateForMonths(startsOn, months);
  const previousMeters = metersFromRaw(input.leaseTermsRaw);

  let base: LeaseTermsDraft | null = null;
  if (isLeaseTerms(input.leaseTermsRaw)) {
    base = leaseTermsToDraft(input.leaseTermsRaw);
  } else if (isLeaseTermsDraft(input.leaseTermsRaw)) {
    base = { ...input.leaseTermsRaw };
  }

  if (base) {
    const monthlyRentMinor = parseMoney(base.monthlyRent, digits) ?? Number(input.rentMinor) ?? 0;
    const schedule = buildRentSchedule({
      startsOn,
      endsOn,
      monthlyRentMinor,
      paymentDay: Number(base.paymentDay) || input.billingDay || 5,
      frequency: base.paymentFrequency,
    });
    return {
      previousMeters,
      draft: {
        ...base,
        startsOn,
        endsOn,
        handoverOn: startsOn,
        municipalFormNo: '',
        municipalContractNo: '',
        schedule: schedule.map((row) => ({
          dueOn: row.dueOn,
          rent: money(row.rentMinor, digits),
          chequeNumber: '',
          bankName: base.chequeBankName ?? '',
        })),
        vatChequeNumbers: [],
        electricityReading: '',
        waterReading: '',
        electricityReadingPhoto: '',
        waterReadingPhoto: '',
      },
    };
  }

  const rent = money(Number(input.rentMinor), digits);
  const paymentFrequency: PaymentFrequency = input.fallbackPaymentFrequency ?? 'monthly';
  const paymentDay = String(input.billingDay || 5);
  const paymentMethod: PaymentMethod = input.fallbackPaymentMethod ?? 'cheque';
  const schedule = buildRentSchedule({
    startsOn,
    endsOn,
    monthlyRentMinor: Number(input.rentMinor) || 0,
    paymentDay: Number(paymentDay),
    frequency: paymentFrequency,
  });

  return {
    previousMeters,
    draft: {
      contractType: input.fallbackContractType || 'residential',
      usageType: input.fallbackContractType || 'residential',
      municipalFormNo: '',
      municipalContractNo: '',
      rentCalcMode: 'full',
      monthlyRent: rent,
      rentAreaSqm: '',
      rentPerSqm: '',
      handoverOn: startsOn,
      startsOn,
      endsOn,
      paymentDay,
      paymentMethod,
      paymentFrequency,
      vatEnabled: Boolean(input.fallbackVatEnabled),
      vatRate: DEFAULT_VAT_RATE_PERCENT,
      vatMode: 'with_rent',
      vatChequeCount: '1',
      municipalityFeeEnabled: true,
      municipalityFeePayer: 'owner',
      registrationFee: '1',
      otherTaxName: '',
      otherTaxRate: '',
      graceAsDiscount: true,
      deposit: input.depositMinor ? money(Number(input.depositMinor), digits) : rent,
      depositItems: [],
      chequeBankName: input.fallbackChequeBankName ?? '',
      chequeAccountName: input.fallbackChequeAccountName ?? '',
      rentBankAccountId: input.fallbackRentBankAccountId ?? '',
      schedule: schedule.map((row) => ({
        dueOn: row.dueOn,
        rent: money(row.rentMinor, digits),
        chequeNumber: '',
        bankName: input.fallbackChequeBankName ?? '',
      })),
      vatChequeNumbers: [],
      adjustments: (input.fallbackAdjustments ?? []).map((row) => ({
        kind: row.kind,
        title: row.title,
        amount: money(Number(row.amountMinor), digits),
        recurrence: 'monthly' as const,
        scope: 'contract_end' as const,
        months: '',
      })),
      electricityReading: '',
      waterReading: '',
      notes: '',
    },
  };
}
