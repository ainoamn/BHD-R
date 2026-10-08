import { describe, expect, it } from 'vitest';
import {
  addMonths,
  buildRentSchedule,
  computeLeaseTerms,
  contractPeriod,
  endDateForMonths,
  formatMinor,
  nextChequeNumber,
  type LeaseTermsDraft,
} from '@/lib/lease-terms';

function draft(overrides: Partial<LeaseTermsDraft> = {}): LeaseTermsDraft {
  const base: LeaseTermsDraft = {
    contractType: 'residential',
    usageType: 'residential',
    rentCalcMode: 'full',
    monthlyRent: '300',
    startsOn: '2026-11-01',
    endsOn: '2027-10-31',
    paymentDay: '5',
    paymentMethod: 'cheque',
    paymentFrequency: 'monthly',
    vatEnabled: false,
    vatRate: '5',
    vatMode: 'with_rent',
    vatChequeCount: '1',
    municipalityFeeEnabled: true,
    registrationFee: '1',
    graceAsDiscount: true,
    deposit: '300',
    depositItems: [],
    schedule: [],
    vatChequeNumbers: [],
    adjustments: [],
  };
  const merged = { ...base, ...overrides };
  if (!overrides.schedule) {
    merged.schedule = buildRentSchedule({
      startsOn: merged.startsOn,
      endsOn: merged.endsOn,
      monthlyRentMinor: 300_000,
      paymentDay: 5,
      frequency: merged.paymentFrequency,
    }).map((row) => ({ dueOn: row.dueOn, rent: formatMinor(row.rentMinor, 3) }));
  }
  return merged;
}

describe('lease term dates', () => {
  it('clamps month arithmetic to the month end', () => {
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(endDateForMonths('2026-11-01', 12)).toBe('2027-10-31');
  });

  it('splits a term into whole months and extra days', () => {
    expect(contractPeriod('2026-11-01', '2027-10-31')).toEqual({ months: 12, extraDays: 0 });
    expect(contractPeriod('2026-11-01', '2027-11-13')).toEqual({ months: 12, extraDays: 13 });
  });

  it('numbers cheques after the first, keeping prefix and padding', () => {
    expect(nextChequeNumber('000123', 2)).toBe('000125');
    expect(nextChequeNumber('CHQ-9', 1)).toBe('CHQ-10');
    expect(nextChequeNumber('abc', 1)).toBe('');
  });
});

describe('rent schedule', () => {
  it('builds one row per month on the agreed day, never before the start', () => {
    const rows = buildRentSchedule({
      startsOn: '2026-11-10',
      endsOn: endDateForMonths('2026-11-10', 12),
      monthlyRentMinor: 300_000,
      paymentDay: 5,
      frequency: 'monthly',
    });
    expect(rows).toHaveLength(12);
    expect(rows[0]!.dueOn).toBe('2026-11-10');
    expect(rows[1]!.dueOn).toBe('2026-12-05');
  });

  it('groups by payment frequency and prorates extra days', () => {
    const rows = buildRentSchedule({
      startsOn: '2026-11-01',
      endsOn: '2027-11-15',
      monthlyRentMinor: 300_000,
      paymentDay: 1,
      frequency: 'quarterly',
    });
    expect(rows).toHaveLength(5);
    expect(rows[0]!.rentMinor).toBe(900_000);
    expect(rows[4]).toMatchObject({ extraDays: true, rentMinor: 150_000 });
  });
});

describe('computeLeaseTerms', () => {
  it('adds the 3% municipality fee and registration fee to the total rent', () => {
    const result = computeLeaseTerms(draft(), 'OMR', 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.terms.totals.rentMinor).toBe(3_600_000);
    expect(result.terms.totals.municipalityFeeMinor).toBe(108_000);
    expect(result.terms.totals.registrationFeeMinor).toBe(1_000);
    expect(result.terms.totals.grandTotalMinor).toBe(3_709_000);
    expect(result.terms.totals.depositMinor).toBe(300_000);
  });

  it('adds VAT to every payment when it is paid with the rent', () => {
    const result = computeLeaseTerms(draft({ vatEnabled: true }), 'OMR', 3);
    if (!result.ok) throw new Error(result.error);
    expect(result.terms.schedule[0]).toMatchObject({ rentMinor: 300_000, vatMinor: 15_000 });
    expect(result.terms.totals.vatMinor).toBe(180_000);
    expect(result.terms.totals.monthlyRentInclVatMinor).toBe(315_000);
    expect(result.terms.vatCheques).toEqual([]);
  });

  it('splits separate VAT into cheques that sum to the VAT total', () => {
    const result = computeLeaseTerms(
      draft({ vatEnabled: true, vatMode: 'separate', vatChequeCount: '7' }),
      'OMR',
      3,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.terms.vatCheques).toHaveLength(7);
    const sum = result.terms.vatCheques.reduce((total, row) => total + row.amountMinor, 0);
    expect(sum).toBe(180_000);
    expect(result.terms.schedule[0]!.vatMinor).toBe(0);
  });

  it('applies extra charges and discounts by recurrence, plus the grace amount', () => {
    const result = computeLeaseTerms(
      draft({
        handoverOn: '2026-10-22',
        municipalityFeeEnabled: false,
        registrationFee: '0',
        adjustments: [
          {
            kind: 'add',
            title: 'إنترنت',
            amount: '10',
            recurrence: 'monthly',
            scope: 'contract_end',
          },
          {
            kind: 'add',
            title: 'مواقف',
            amount: '15',
            recurrence: 'every_3_months',
            scope: 'one_year',
          },
          {
            kind: 'discount',
            title: 'خصم ترحيبي',
            amount: '50',
            recurrence: 'one_time',
            scope: 'contract_end',
          },
          {
            kind: 'add',
            title: 'رسوم تجديد',
            amount: '20',
            recurrence: 'with_renewal',
            scope: 'contract_end',
          },
        ],
      }),
      'OMR',
      3,
    );
    if (!result.ok) throw new Error(result.error);
    const { totals, graceDays } = result.terms;
    expect(graceDays).toBe(10);
    expect(totals.graceDiscountMinor).toBe(100_000);
    expect(totals.additionsMinor).toBe(120_000 + 60_000);
    expect(totals.discountsMinor).toBe(50_000);
    expect(totals.grandTotalMinor).toBe(3_600_000 + 180_000 - 150_000);
  });

  it('computes per-meter rent from area and rate', () => {
    const result = computeLeaseTerms(
      draft({ rentCalcMode: 'per_meter', rentAreaSqm: '120', rentPerSqm: '2.5' }),
      'OMR',
      3,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.terms.monthlyRentMinor).toBe(300_000);
  });

  it('rejects bad dates, duplicate cheque numbers and empty schedules', () => {
    expect(computeLeaseTerms(draft({ endsOn: '2026-10-01' }), 'OMR', 3)).toEqual({
      ok: false,
      error: 'invalid_dates',
    });
    const base = draft();
    const duplicated = draft({
      schedule: base.schedule.map((row, index) => ({
        ...row,
        chequeNumber: index < 2 ? '100' : '',
      })),
    });
    expect(computeLeaseTerms(duplicated, 'OMR', 3)).toEqual({
      ok: false,
      error: 'duplicate_cheque_number',
    });
    expect(computeLeaseTerms(draft({ schedule: [] }), 'OMR', 3)).toEqual({
      ok: false,
      error: 'invalid_schedule',
    });
  });
});
