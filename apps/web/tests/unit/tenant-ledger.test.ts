import { describe, expect, it } from 'vitest';
import { chargeCategoryOf, chargeInvoiceNumber } from '@/lib/tenant-charges-shared';
import {
  buildLeaseStatement,
  chequeIsAdjustable,
  ledgerTermsOf,
  type LedgerCheque,
  type LedgerTerms,
} from '@/lib/tenant-ledger';

const terms: LedgerTerms = {
  startsOn: '2026-01-01',
  paymentMethod: 'cheque',
  grandTotalMinor: 3_150_000,
  schedule: [1, 2, 3].map((index) => ({
    index,
    periodFrom: `2026-0${index * 3 - 2}-01`,
    periodTo: null,
    dueOn: `2026-0${index * 3 - 2}-01`,
    totalMinor: 1_000_000,
    chequeNumber: `10${index}`,
    bankName: 'Bank Muscat',
  })),
  vatCheques: [],
  depositItems: [
    { method: 'cheque', amountMinor: 500_000, reference: '900', bankName: null, dueOn: null },
  ],
};

function cheque(number: string, status: LedgerCheque['reviewStatus'], dueOn: string): LedgerCheque {
  return {
    id: `c-${number}`,
    chequeNumber: number,
    bankName: 'Bank Muscat',
    amountMinor: '1000000',
    dueOn,
    reviewStatus: status,
  };
}

describe('buildLeaseStatement', () => {
  it('matches cheques to the schedule and totals paid, overdue and remaining', () => {
    const result = buildLeaseStatement({
      terms,
      contractAmountMinor: null,
      cheques: [
        cheque('101', 'cleared', '2026-01-01'),
        cheque('102', 'bounced', '2026-04-01'),
        cheque('103', 'pending', '2026-08-15'),
      ],
      invoices: [],
      today: '2026-07-10',
    });
    const rent = result.lines.filter((line) => line.kind === 'rent');
    expect(rent.map((line) => line.status)).toEqual(['paid', 'bounced', 'upcoming']);
    expect(rent[2]?.dueOn).toBe('2026-08-15');
    expect(rent[2]?.originalDueOn).toBe('2026-07-01');
    expect(result.contractTotalMinor).toBe('3150000');
    expect(result.paidMinor).toBe('1000000');
    expect(result.overdueMinor).toBe('1000000');
    expect(result.remainingMinor).toBe('2150000');
    expect(result.nextDue).toEqual({ dueOn: '2026-08-15', amountMinor: '1000000' });
  });

  it('adds the contract fees as a line and keeps the deposit outside the total', () => {
    const result = buildLeaseStatement({
      terms,
      contractAmountMinor: null,
      cheques: [],
      invoices: [],
      today: '2026-01-02',
    });
    const fees = result.lines.find((line) => line.kind === 'fees');
    const deposit = result.lines.find((line) => line.kind === 'deposit');
    expect(fees?.amountMinor).toBe('150000');
    expect(fees?.status).toBe('due');
    expect(deposit?.outsideTotal).toBe(true);
    expect(result.overdueMinor).toBe('1000000');
  });

  it('treats a held cheque past its date as being collected, not as the tenant being late', () => {
    const result = buildLeaseStatement({
      terms: { ...terms, grandTotalMinor: 3_000_000, depositItems: [] },
      contractAmountMinor: null,
      cheques: [cheque('101', 'accepted', '2026-01-01')],
      invoices: [],
      today: '2026-02-01',
    });
    expect(result.lines[0]?.status).toBe('collecting');
    expect(result.overdueMinor).toBe('0');
    expect(chequeIsAdjustable(result.lines[0]!)).toBe(true);
  });

  it('pays cash installments from the matching invoice and lists the rest as other invoices', () => {
    const cash: LedgerTerms = {
      ...terms,
      paymentMethod: 'cash',
      grandTotalMinor: 3_000_000,
      schedule: terms.schedule.map((row) => ({ ...row, chequeNumber: null })),
      depositItems: [],
    };
    const result = buildLeaseStatement({
      terms: cash,
      contractAmountMinor: null,
      cheques: [],
      invoices: [
        {
          id: 'i1',
          number: 'INV-1',
          status: 'paid',
          issuedOn: '2026-01-01',
          dueOn: '2026-01-01',
          totalMinor: '1000000',
          paidMinor: '1000000',
          billingPeriodStart: '2026-01-01',
        },
        {
          id: 'i2',
          number: 'INV-FINE',
          status: 'issued',
          issuedOn: '2026-02-01',
          dueOn: '2026-02-10',
          totalMinor: '50000',
          paidMinor: '0',
          billingPeriodStart: null,
        },
      ],
      today: '2026-05-01',
    });
    expect(result.lines[0]?.status).toBe('paid');
    expect(result.lines[0]?.invoiceNumber).toBe('INV-1');
    expect(result.lines[1]?.status).toBe('overdue');
    expect(result.otherInvoices.map((invoice) => invoice.number)).toEqual(['INV-FINE']);
    expect(result.otherOutstandingMinor).toBe('50000');
  });

  it('falls back to the invoices when the lease has no contract schedule or cheques', () => {
    const result = buildLeaseStatement({
      terms: null,
      contractAmountMinor: '2400000',
      cheques: [],
      invoices: [
        {
          id: 'i1',
          number: 'INV-1',
          status: 'partially_paid',
          issuedOn: '2026-01-01',
          dueOn: '2026-01-05',
          totalMinor: '200000',
          paidMinor: '50000',
          billingPeriodStart: '2026-01-01',
        },
      ],
      today: '2026-02-01',
    });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.status).toBe('partially_paid');
    expect(result.contractTotalMinor).toBe('2400000');
    expect(result.paidMinor).toBe('50000');
    expect(result.overdueMinor).toBe('150000');
    expect(result.remainingMinor).toBe('2350000');
  });

  it('keeps charge invoices out of the installments and lists every arrear by category', () => {
    const invoice = (id: string, number: string, dueOn: string, total: string, paid = '0') => ({
      id,
      number,
      status: 'issued',
      issuedOn: dueOn,
      dueOn,
      totalMinor: total,
      paidMinor: paid,
      billingPeriodStart: null,
    });
    const result = buildLeaseStatement({
      terms: null,
      contractAmountMinor: null,
      cheques: [cheque('101', 'bounced', '2026-01-01')],
      invoices: [
        invoice('e1', 'ELC-260110-AAAAAA', '2026-01-20', '30000'),
        invoice('w1', 'WTR-260110-BBBBBB', '2026-01-25', '12000', '2000'),
        invoice('m1', 'MNT-260301-CCCCCC', '2026-03-01', '80000'),
      ],
      today: '2026-02-01',
    });
    expect(result.lines.map((line) => line.kind)).toEqual(['cheque']);
    expect(result.otherInvoices).toHaveLength(3);
    expect(result.arrears.items.map((item) => item.category)).toEqual([
      'cheque',
      'electricity',
      'water',
    ]);
    expect(result.arrears.totalMinor).toBe('1040000');
    expect(result.arrears.byCategory[0]).toEqual({ category: 'cheque', amountMinor: '1000000' });
  });
});

describe('charge invoices', () => {
  it('round-trips the category through the invoice number', () => {
    const number = chargeInvoiceNumber('damage', '2026-10-14', 'a1-b2c3d4');
    expect(number).toBe('DMG-261014-A1B2C3');
    expect(chargeCategoryOf(number)).toBe('damage');
    expect(chargeCategoryOf('INV-0001')).toBeNull();
  });
});

describe('ledgerTermsOf', () => {
  it('reads lease terms from a contract payload and ignores anything else', () => {
    expect(ledgerTermsOf(null)).toBeNull();
    expect(ledgerTermsOf({ leaseTerms: { startsOn: 3 } })).toBeNull();
    const parsed = ledgerTermsOf({
      leaseTerms: { ...terms, totals: { grandTotalMinor: 3_150_000 } },
    });
    expect(parsed?.schedule).toHaveLength(3);
    expect(parsed?.grandTotalMinor).toBe(3_150_000);
  });

  it('coerces string amounts so JSON-serialized schedules still parse', () => {
    const parsed = ledgerTermsOf({
      leaseTerms: {
        startsOn: '2026-01-01',
        paymentMethod: 'cheque',
        totals: { grandTotalMinor: '180000' },
        schedule: [
          {
            index: 1,
            dueOn: '2026-01-05',
            totalMinor: '180000',
            rentMinor: '180000',
            chequeNumber: null,
          },
        ],
        vatCheques: [],
        depositItems: [],
      },
    });
    expect(parsed?.schedule).toHaveLength(1);
    expect(parsed?.schedule[0]?.totalMinor).toBe(180_000);
    expect(parsed?.grandTotalMinor).toBe(180_000);
  });
});
