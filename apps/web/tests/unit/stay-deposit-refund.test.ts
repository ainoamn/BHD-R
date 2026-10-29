import { describe, expect, it } from 'vitest';
import {
  depositHolding,
  depositReceiptNumbers,
  depositRefundStage,
  guestDepositRefund,
  retainedDepositMinor,
  hasDeposit,
  maskAccount,
  REFUND_CONSENT,
  REFUND_CONSENT_VERSION,
  refundNotices,
  validPayoutAccount,
  type DepositRefundView,
} from '@/lib/stay-deposit-refund';
import { pendingApprovalHref, type PendingApprovalItem } from '@/lib/pending-approvals-shared';
import {
  stayJourneyCurrent,
  stayJourneyInitialStep,
  stayJourneyScreens,
  type StayRefundMoment,
} from '@/lib/stay-guest-greeting';

const view: DepositRefundView = {
  id: 'r1',
  status: 'executed',
  amountMinor: '80000',
  currency: 'OMR',
  requestedAt: '2026-10-12T08:00:00.000Z',
  requestedBy: 'guest',
  consent: null,
  guestNote: null,
  guestPayout: null,
  decidedAt: '2026-10-12T09:00:00.000Z',
  decidedBy: 'Owner',
  decisionNote: null,
  settledDepositMinor: null,
  paidMinor: '80000',
  transferRecordedAt: '2026-10-12T10:05:00.000Z',
  guestReceipt: null,
  guestReceiptAt: null,
  transfer: {
    method: 'bank',
    account: 'OM81 0123 4567 8901 2345',
    bank: 'Bank Muscat',
    holder: 'Guest',
    reference: 'TRX-1',
    at: '2026-10-12T10:00:00.000Z',
    recordedBy: 'Accountant',
    hasReceipt: true,
  },
};

const moment = (state: StayRefundMoment['state']): StayRefundMoment => ({
  state,
  referenceCode: 'ST-FE61E6C8',
  deposit: '80 OMR',
  amount: state === 'open' ? null : '80 OMR',
  requestedAt: null,
  decidedAt: null,
  note: state === 'rejected' ? 'Damage' : null,
  paidAt: null,
  paidTo: null,
});

describe('deposit refund', () => {
  it('stays a pending step for the host after check-out until decided and transferred', () => {
    expect(depositRefundStage('checked_out', '80000', null)).toBe('awaiting_deposit_refund');
    expect(depositRefundStage('checked_out', '80000', 'requested')).toBe('awaiting_deposit_refund');
    expect(depositRefundStage('checked_out', '80000', 'approved')).toBe('awaiting_refund_transfer');
    expect(depositRefundStage('checked_out', '80000', 'executed')).toBeNull();
    expect(depositRefundStage('checked_out', null, null)).toBeNull();
    expect(depositRefundStage('checked_in', '80000', null)).toBeNull();
    expect(depositRefundStage('closed', '80000', null)).toBeNull();
  });

  it('sends the host decision to Bookings and the transfer to Accounting', () => {
    const item = (kind: PendingApprovalItem['kind']): PendingApprovalItem => ({
      kind,
      id: 'b1',
      reference: 'ST-1',
      propertyId: 'p1',
      propertyNameAr: 'مبنى',
      propertyNameEn: null,
      unitCode: null,
      party: null,
      contractType: null,
      fromOn: null,
      requestedAt: '',
    });
    expect(pendingApprovalHref('owner', item('deposit_refund'))).toBe(
      '/owner/properties/p1?section=bookings&focus=b1',
    );
    expect(pendingApprovalHref('owner', item('refund_transfer'))).toBe(
      '/owner/accounting?tab=deposits&focus=b1',
    );
  });

  it('keeps deposits out of income until settled, then books only the deduction', () => {
    expect(depositHolding('checked_in', null)).toBe('deposit_held');
    expect(depositHolding('confirmed', null)).toBe('deposit_held');
    expect(depositHolding('checked_out', null)).toBe('awaiting_deposit_refund');
    expect(depositHolding('checked_out', 'requested')).toBe('awaiting_deposit_refund');
    expect(depositHolding('checked_out', 'approved')).toBe('awaiting_refund_transfer');
    expect(depositHolding('closed', 'executed')).toBe('deposit_settled');
    expect(depositHolding('closed', 'rejected')).toBe('deposit_settled');

    expect(retainedDepositMinor('80000', 'approved', '60000')).toBeNull();
    expect(retainedDepositMinor('80000', 'executed', '60000')).toBe('20000');
    expect(retainedDepositMinor('80000', 'executed', '80000')).toBeNull();
    expect(retainedDepositMinor('80000', 'rejected', '80000')).toBe('80000');
    expect(retainedDepositMinor(null, 'executed', '60000')).toBeNull();
  });

  it('links the refund and income receipts of one stay', () => {
    expect(depositReceiptNumbers('ST-FE61E6C8')).toEqual({
      refund: 'DR-FE61E6C8',
      income: 'DI-FE61E6C8',
    });
  });

  it('accepts bank accounts / IBANs and phone numbers only', () => {
    expect(validPayoutAccount('bank', 'OM81 0123 4567 8901 2345')).toBe(true);
    expect(validPayoutAccount('bank', '12')).toBe(false);
    expect(validPayoutAccount('bank', '0123<script>')).toBe(false);
    expect(validPayoutAccount('phone', '+968 9123 4567')).toBe(true);
    expect(validPayoutAccount('phone', 'abc')).toBe(false);
    expect(hasDeposit('0')).toBe(false);
    expect(hasDeposit('80000')).toBe(true);
  });

  it('shows the guest a masked account, never the full number', () => {
    const guest = guestDepositRefund(view);
    expect(guest.paidTo).toBe('Bank Muscat · ••••2345');
    expect(JSON.stringify(guest)).not.toContain('0123 4567');
    expect(maskAccount('1234')).toBe('1234');
  });

  it('adds a fifth journey step after check-out that completes once settled', () => {
    expect(stayJourneyCurrent('checked_out', moment('open'))).toBe(4);
    expect(stayJourneyCurrent('checked_out', moment('approved'))).toBe(4);
    expect(stayJourneyCurrent('closed', moment('paid'))).toBe(5);
    expect(stayJourneyCurrent('closed', moment('rejected'))).toBe(5);
    expect(stayJourneyCurrent('checked_out')).toBe(4);
    const screens = stayJourneyScreens({
      status: 'checked_out',
      ar: true,
      welcome: false,
      mode: 'request',
      refund: moment('open'),
    });
    expect(screens).toHaveLength(5);
    expect(screens[4]?.stage).toBe('refund');
    expect(screens[4]?.refund?.state).toBe('open');
    expect(stayJourneyInitialStep('checked_out', false, moment('open'))).toBe(4);
    expect(stayJourneyInitialStep('closed', false, moment('paid'))).toBe(4);
    const confirmed = stayJourneyScreens({
      status: 'confirmed',
      ar: true,
      welcome: false,
      refund: moment('open'),
    });
    expect(confirmed[4]).toBeNull();
  });

  it('notifies the guest at each host step, newest first, with stable ids', () => {
    const format = { money: (minor: string) => `${minor} bz`, stamp: (iso: string) => iso };
    const paid = refundNotices(guestDepositRefund(view), true, format);
    expect(paid.map((notice) => notice.kind)).toEqual(['paid', 'approved', 'requested']);
    expect(paid[0]?.id).toBe('paid:2026-10-12T10:00:00.000Z');
    expect(paid[0]?.body).toContain('••••2345');
    expect(JSON.stringify(paid)).not.toContain('0123 4567');
    const rejected = refundNotices(
      { ...guestDepositRefund(view), status: 'rejected', decisionNote: 'Damage', paidAt: null },
      false,
      format,
    );
    expect(rejected.map((notice) => notice.kind)).toEqual(['rejected', 'requested']);
    expect(rejected[0]?.body).toBe('Reason: Damage');
    const requested = refundNotices(
      { ...guestDepositRefund(view), status: 'requested', decidedAt: null, paidAt: null },
      true,
      format,
    );
    expect(requested.map((notice) => notice.kind)).toEqual(['requested']);
    expect(requested[0]?.body).toContain('أسبوعَي عمل');
  });

  it("tells the guest the accountant's transfer note with the transfer notice", () => {
    const format = { money: (minor: string) => `${minor} bz`, stamp: (iso: string) => iso };
    const noted = guestDepositRefund({
      ...view,
      transfer: { ...view.transfer!, note: 'Bank fee 0.500 OMR deducted' },
    });
    expect(noted.paidNote).toBe('Bank fee 0.500 OMR deducted');
    const [paid] = refundNotices(noted, false, format);
    expect(paid?.body).toContain('Transfer note: Bank fee 0.500 OMR deducted');
    expect(refundNotices(guestDepositRefund(view), true, format)[0]?.body).not.toContain(
      'ملاحظة التحويل',
    );
  });

  it('asks the guest to accept the refund timeframe and the notices', () => {
    expect(REFUND_CONSENT_VERSION).toMatch(/^refund-terms-/);
    expect(REFUND_CONSENT.ar.join(' ')).toContain('يوم عمل واحد حتى أسبوعَي عمل');
    expect(REFUND_CONSENT.ar.join(' ')).toContain('إشعار');
    expect(REFUND_CONSENT.en).toHaveLength(REFUND_CONSENT.ar.length);
  });
});
