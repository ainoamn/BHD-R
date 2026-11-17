import { describe, expect, it } from 'vitest';
import { applyGlEvidenceToStatement } from '@/lib/accounting-tenant-gl-shared';
import { buildLeaseStatement, type LedgerTerms } from '@/lib/tenant-ledger';

const terms: LedgerTerms = {
  startsOn: '2026-01-01',
  paymentMethod: 'cheque',
  grandTotalMinor: 1_000_000,
  schedule: [
    {
      index: 1,
      periodFrom: '2026-01-01',
      periodTo: null,
      dueOn: '2026-01-01',
      totalMinor: 1_000_000,
      chequeNumber: '101',
      bankName: 'Bank Muscat',
    },
  ],
  vatCheques: [],
  depositItems: [],
};

describe('applyGlEvidenceToStatement', () => {
  it('ignores cleared cheques that have no posted collect journal', () => {
    const draft = buildLeaseStatement({
      terms,
      contractAmountMinor: null,
      cheques: [
        {
          id: 'c1',
          chequeNumber: '101',
          bankName: 'Bank Muscat',
          amountMinor: '1000000',
          dueOn: '2026-01-01',
          reviewStatus: 'cleared',
        },
      ],
      invoices: [],
      today: '2026-02-01',
    });
    expect(draft.lines[0]?.paidMinor).toBe('1000000');
    const reconciled = applyGlEvidenceToStatement(draft, {
      arOpenMinor: '1000000',
      depositHeldMinor: '0',
      paidByInvoiceId: new Map(),
      glBackedChequeIds: new Set(),
      paymentJournalIds: new Set(),
    });
    expect(reconciled.lines[0]?.paidMinor).toBe('0');
    expect(reconciled.arVarianceMinor).toBe('0');
  });

  it('marks paid when collect journal backs the cheque', () => {
    const draft = buildLeaseStatement({
      terms,
      contractAmountMinor: null,
      cheques: [
        {
          id: 'c1',
          chequeNumber: '101',
          bankName: 'Bank Muscat',
          amountMinor: '1000000',
          dueOn: '2026-01-01',
          reviewStatus: 'cleared',
        },
      ],
      invoices: [],
      today: '2026-02-01',
    });
    const reconciled = applyGlEvidenceToStatement(draft, {
      arOpenMinor: '0',
      depositHeldMinor: '0',
      paidByInvoiceId: new Map(),
      glBackedChequeIds: new Set(['c1']),
      paymentJournalIds: new Set(),
    });
    expect(reconciled.lines[0]?.paidMinor).toBe('1000000');
    expect(reconciled.lines[0]?.status).toBe('paid');
  });
});
