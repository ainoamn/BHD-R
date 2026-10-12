import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  claimEscalationFrom,
  claimsOpenFrom,
  depositReceiptState,
  whatsappDigits,
  whatsappLink,
} from '@/lib/stay-deposit-claims';
import { refundDueMinor } from '@/lib/stay-deposit-refund';

const HOUR = 3_600_000;

describe('deposit receipt and claims', () => {
  it('waits 24 hours for the guest, then counts the transfer as received', () => {
    const recorded = '2026-10-12T10:00:00.000Z';
    const base = { status: 'executed', guestReceipt: null, transferRecordedAt: recorded };
    const start = Date.parse(recorded);
    expect(depositReceiptState(base, start + HOUR)).toEqual({
      state: 'pending',
      deadline: '2026-10-13T10:00:00.000Z',
    });
    expect(depositReceiptState(base, start + 25 * HOUR)?.state).toBe('auto');
    expect(depositReceiptState({ ...base, guestReceipt: 'confirmed' })?.state).toBe('confirmed');
    expect(depositReceiptState({ ...base, guestReceipt: 'not_received' })?.state).toBe(
      'not_received',
    );
    expect(depositReceiptState({ ...base, status: 'approved' })).toBeNull();
    expect(depositReceiptState({ ...base, transferRecordedAt: null })?.state).toBe('auto');
  });

  it('counts Omani working days, skipping Friday and Saturday', () => {
    // Thursday 15 Oct 2026, 10:00 Muscat → Sunday, Monday, Tuesday.
    expect(addBusinessDays('2026-10-15T06:00:00.000Z', 3)).toBe('2026-10-20T06:00:00.000Z');
    // Sunday → Wednesday.
    expect(addBusinessDays('2026-10-11T06:00:00.000Z', 3)).toBe('2026-10-14T06:00:00.000Z');
  });

  it('opens escalation 3 working days after the refund, once the host answered or went quiet', () => {
    const settled = '2026-10-11T06:00:00.000Z';
    const answered = claimEscalationFrom(
      {
        status: 'rejected',
        createdAt: '2026-10-11T08:00:00.000Z',
        respondedAt: '2026-10-12T08:00:00.000Z',
      },
      settled,
    );
    expect(answered).toBe('2026-10-14T06:00:00.000Z');
    const silent = claimEscalationFrom(
      { status: 'open', createdAt: '2026-10-13T08:00:00.000Z', respondedAt: null },
      settled,
    );
    expect(silent).toBe('2026-10-18T08:00:00.000Z');
    expect(
      claimEscalationFrom(
        { status: 'escalated', createdAt: settled, respondedAt: settled },
        settled,
      ),
    ).toBeNull();
  });

  it('opens guest requests on transfer or rejection, else two working weeks after the request', () => {
    // Monday 12 Oct 2026, 10:52 Muscat → ten working days → Monday 26 Oct.
    const requestedAt = '2026-10-12T06:52:00.000Z';
    expect(claimsOpenFrom({ status: 'requested', requestedAt, paidMinor: '0' })).toBe(
      '2026-10-26T06:52:00.000Z',
    );
    expect(claimsOpenFrom({ status: 'approved', requestedAt, paidMinor: '0' })).toBe(
      '2026-10-26T06:52:00.000Z',
    );
    expect(claimsOpenFrom({ status: 'approved', requestedAt, paidMinor: '60000' })).toBeNull();
    expect(claimsOpenFrom({ status: 'executed', requestedAt, paidMinor: '60000' })).toBeNull();
    expect(claimsOpenFrom({ status: 'rejected', requestedAt, paidMinor: '0' })).toBeNull();
  });

  it('transfers only what is still due on an approved refund', () => {
    expect(refundDueMinor({ status: 'approved', amountMinor: '70000', paidMinor: '60000' })).toBe(
      '10000',
    );
    expect(refundDueMinor({ status: 'approved', amountMinor: '60000', paidMinor: '0' })).toBe(
      '60000',
    );
    expect(refundDueMinor({ status: 'executed', amountMinor: '60000', paidMinor: '60000' })).toBe(
      null,
    );
  });

  it('builds WhatsApp links for Omani and international numbers', () => {
    expect(whatsappDigits('9123 4567')).toBe('96891234567');
    expect(whatsappDigits('+968 9123 4567')).toBe('96891234567');
    expect(whatsappDigits('00968 91234567')).toBe('96891234567');
    expect(whatsappDigits('123')).toBeNull();
    expect(whatsappLink('91234567', 'شكوى')).toBe(
      'https://wa.me/96891234567?text=%D8%B4%D9%83%D9%88%D9%89',
    );
  });
});
