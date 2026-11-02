import { describe, expect, it } from 'vitest';
import { addDays } from '@/lib/lease-terms';
import { buildBookingLeaseTermsDraft, muscatTodayIso } from '@/lib/lease-terms-draft-from';

describe('buildBookingLeaseTermsDraft', () => {
  it('copies contract type/usage and term from the booking and sets handover to sign+1', () => {
    const signedOn = '2026-11-02';
    const draft = buildBookingLeaseTermsDraft({
      currency: 'OMR',
      rentMinor: '300000',
      depositMinor: '300000',
      contractType: 'commercial',
      termMonths: 12,
      signedOn,
      bank: {
        id: 'bank-1',
        bankName: 'Bank Muscat',
        accountHolderName: 'Owner Name',
      },
    });
    expect(draft.contractType).toBe('commercial');
    expect(draft.usageType).toBe('commercial');
    expect(draft.handoverOn).toBe(addDays(signedOn, 1));
    expect(draft.startsOn).toBe(draft.handoverOn);
    expect(draft.endsOn > draft.startsOn).toBe(true);
    expect(draft.monthlyRent).toBe('300');
    expect(draft.paymentMethod).toBe('cheque');
    expect(draft.rentBankAccountId).toBe('bank-1');
  });

  it('defaults signing day to Muscat today when omitted', () => {
    const draft = buildBookingLeaseTermsDraft({
      currency: 'OMR',
      rentMinor: '100000',
      depositMinor: '100000',
      contractType: 'residential',
      termMonths: 6,
    });
    const today = muscatTodayIso();
    expect(draft.handoverOn).toBe(addDays(today, 1));
    expect(draft.startsOn).toBe(draft.handoverOn);
    expect(draft.contractType).toBe('residential');
    expect(draft.usageType).toBe('residential');
  });
});
