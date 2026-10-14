import { describe, expect, it } from 'vitest';
import {
  findRentDocSubject,
  isRentDocKey,
  maskedPersonName,
  rentDocHref,
  rentDocKindsOf,
  rentDocNumber,
  rentDocSubjects,
  rentMonthLabel,
} from '@/lib/rent-documents';
import {
  buildLeaseStatement,
  installmentInvoiceNumber,
  installmentKeyOf,
  type LedgerInvoice,
  type LedgerTerms,
} from '@/lib/tenant-ledger';

const LEASE = '99eb6705-39b7-4469-9774-25ce475608ee';

const terms: LedgerTerms = {
  startsOn: '2026-10-13',
  paymentMethod: 'cheque',
  grandTotalMinor: 3 * 180_000 + 20_000,
  schedule: [1, 2, 3].map((index) => ({
    index,
    periodFrom: `2026-${String(9 + index).padStart(2, '0')}-13`,
    periodTo: `2026-${String(10 + index).padStart(2, '0')}-12`,
    dueOn: `2026-${String(9 + index).padStart(2, '0')}-13`,
    totalMinor: 180_000,
    chequeNumber: null,
    bankName: null,
  })),
  vatCheques: [],
  depositItems: [],
};

function invoice(number: string, totalMinor: number, paidMinor: number): LedgerInvoice {
  return {
    id: `00000000-0000-4000-8000-${number.length.toString().padStart(12, '0')}`,
    number,
    status: paidMinor >= totalMinor ? 'paid' : paidMinor > 0 ? 'partially_paid' : 'issued',
    issuedOn: '2026-10-13',
    dueOn: '2026-10-13',
    totalMinor: String(totalMinor),
    paidMinor: String(paidMinor),
    billingPeriodStart: null,
  };
}

describe('installment receipt invoices', () => {
  it('numbers and reads back the line an installment invoice records', () => {
    const number = installmentInvoiceNumber(LEASE, 'rent-3');
    expect(number).toBe('RNT-99EB6705-RENT-3');
    expect(installmentKeyOf(number)).toBe('rent-3');
    expect(installmentKeyOf('RNT-99EB6705-FEES')).toBe('fees');
    expect(installmentKeyOf('MNT-261014-4F7A2C')).toBeNull();
  });

  it('pays the matching installment and keeps it out of the other invoices', () => {
    const statement = buildLeaseStatement({
      terms,
      contractAmountMinor: null,
      cheques: [],
      invoices: [
        { ...invoice(installmentInvoiceNumber(LEASE, 'rent-2'), 180_000, 180_000), id: 'inv-2' },
        { ...invoice(installmentInvoiceNumber(LEASE, 'fees'), 20_000, 5_000), id: 'inv-f' },
      ],
      today: '2026-12-20',
    });
    const rent = statement.lines.filter((line) => line.kind === 'rent');
    expect(rent.map((line) => line.status)).toEqual(['overdue', 'paid', 'overdue']);
    expect(rent[1]?.invoiceId).toBe('inv-2');
    expect(statement.lines.find((line) => line.kind === 'fees')?.paidMinor).toBe('5000');
    expect(statement.otherInvoices).toEqual([]);
    expect(statement.paidMinor).toBe('185000');
  });
});

describe('rent documents', () => {
  const statement = buildLeaseStatement({
    terms,
    contractAmountMinor: null,
    cheques: [],
    invoices: [
      { ...invoice(installmentInvoiceNumber(LEASE, 'rent-1'), 180_000, 100_000), id: 'inv-1' },
      { ...invoice(installmentInvoiceNumber(LEASE, 'rent-2'), 180_000, 180_000), id: 'inv-2' },
      {
        ...invoice('ELC-261020-AB12CD', 12_500, 0),
        id: '11111111-2222-4333-8444-555555555555',
        dueOn: '2026-11-01',
      },
    ],
    today: '2026-11-20',
  });

  it('offers a receipt for what was paid and an invoice for what is left', () => {
    const part = findRentDocSubject(statement, 'rent-1')!;
    const paid = findRentDocSubject(statement, 'rent-2')!;
    const unpaid = findRentDocSubject(statement, 'rent-3')!;
    expect(rentDocKindsOf(part)).toEqual(['receipt', 'invoice']);
    expect(part.outstandingMinor).toBe('80000');
    expect(rentDocKindsOf(paid)).toEqual(['receipt']);
    expect(rentDocKindsOf(unpaid)).toEqual(['invoice']);
  });

  it('includes bills on the lease as charge subjects', () => {
    const bill = rentDocSubjects(statement).find((subject) => subject.kind === 'charge');
    expect(bill?.key).toBe('charge-11111111-2222-4333-8444-555555555555');
    expect(bill?.label.ar).toBe('فاتورة كهرباء');
    expect(rentDocKindsOf(bill!)).toEqual(['invoice']);
  });

  it('names the month the installment is for', () => {
    const first = findRentDocSubject(statement, 'rent-1')!;
    expect(rentMonthLabel(first, true)).toBe('أكتوبر 2026');
    expect(rentMonthLabel(first, false)).toBe('October 2026');
    expect(
      rentMonthLabel(
        { periodFrom: '2026-11-01', periodTo: '2027-01-31', dueOn: '2026-11-01' },
        true,
      ),
    ).toBe('نوفمبر 2026 – يناير 2027');
    expect(rentMonthLabel({ periodFrom: null, periodTo: null, dueOn: '2026-03-05' }, true)).toBe(
      'مارس 2026',
    );
  });

  it('numbers documents from the contract reference', () => {
    expect(rentDocNumber('receipt', 'CTR-2026-000004', LEASE, 'rent-3')).toBe('RC-2026-000004-R03');
    expect(rentDocNumber('invoice', null, LEASE, 'fees')).toBe('INV-99EB6705-F00');
    expect(rentDocNumber('invoice', 'CTR-2026-000004', LEASE, 'deposit-0')).toBe(
      'INV-2026-000004-D01',
    );
  });

  it('accepts only statement keys and builds portal links', () => {
    expect(isRentDocKey('rent-12')).toBe(true);
    expect(isRentDocKey('charge-11111111-2222-4333-8444-555555555555')).toBe(true);
    expect(isRentDocKey('../etc')).toBe(false);
    expect(rentDocHref('tenant', LEASE, 'rent-1', 'receipt')).toBe(
      `/tenant/invoices/${LEASE}/rent-1?doc=receipt`,
    );
  });

  it('shortens names on public pages', () => {
    expect(maskedPersonName('Abdul Hamid Al Rawahi')).toBe('Abdul Hamid A. R.');
    expect(maskedPersonName('عبد الحميد الرواحي')).toBe('عبد الحميد ا.');
    expect(maskedPersonName('Salim Al Harthy')).toBe('Salim A. H.');
    expect(maskedPersonName('')).toBe('—');
  });
});
