import { describe, expect, it } from 'vitest';
import { buildContractChequeAnnex } from '@/lib/contract-cheque-annex';

describe('contract cheque annex', () => {
  it('joins reservation instructions with submitted cheque numbers', () => {
    const annex = buildContractChequeAnnex({
      reference: 'CTR-1-CHQ',
      lifecycle: {
        chequeInstructions: [
          {
            key: 'rent-0',
            kind: 'rent',
            labelAr: 'شيك إيجار #1',
            labelEn: 'Rent cheque #1',
            dueOn: '2026-11-05',
            amountMinor: 800000,
            currency: 'OMR',
          },
          {
            key: 'deposit-0',
            kind: 'deposit',
            labelAr: 'شيك تأمين #1',
            labelEn: 'Deposit cheque #1',
            dueOn: null,
            amountMinor: 1000000,
            currency: 'OMR',
          },
        ],
        chequeSubmissions: [
          { key: 'rent-0', chequeNumber: '001', bankName: 'بنك مسقط' },
          { key: 'deposit-0', chequeNumber: '013', bankName: 'بنك مسقط' },
        ],
      },
      leaseTerms: null,
    });
    expect(annex?.reference).toBe('CTR-1-CHQ');
    expect(annex?.rows.map((row) => row.chequeNumber)).toEqual(['001', '013']);
    expect(annex?.rows[0]?.dueOn).toBe('2026-11-05');
    expect(annex?.rows[1]?.kind).toBe('deposit');
  });
});
