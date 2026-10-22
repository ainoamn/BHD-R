import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  claimEscalationFrom,
  claimsOpenFrom,
  depositReceiptState,
  guestDepositNextStep,
  propertyTrackAutoEscalateFrom,
  siteDecisionDueFrom,
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
    expect(addBusinessDays('2026-10-15T06:00:00.000Z', 3)).toBe('2026-10-20T06:00:00.000Z');
    expect(addBusinessDays('2026-10-11T06:00:00.000Z', 3)).toBe('2026-10-14T06:00:00.000Z');
  });

  it('auto-escalates unanswered property complaints after 7 working days', () => {
    const created = '2026-10-11T06:00:00.000Z';
    expect(propertyTrackAutoEscalateFrom(created)).toBe('2026-10-20T06:00:00.000Z');
    expect(
      claimEscalationFrom(
        {
          status: 'open',
          createdAt: created,
          respondedAt: null,
          kind: 'property_complaint',
        },
        created,
      ),
    ).toBe('2026-10-20T06:00:00.000Z');
    expect(
      claimEscalationFrom(
        { status: 'rejected', createdAt: created, respondedAt: created, kind: 'deduction' },
        created,
      ),
    ).toBeNull();
  });

  it('walks claim → property complaint → appeal → site complaint', () => {
    expect(guestDepositNextStep([])).toEqual({ step: 'claim' });
    expect(
      guestDepositNextStep([
        { kind: 'not_received', status: 'rejected', createdAt: 'a' },
        { kind: 'deduction', status: 'accepted', createdAt: 'b' },
      ]),
    ).toEqual({ step: 'property_complaint' });
    expect(
      guestDepositNextStep([
        { kind: 'not_received', status: 'rejected', createdAt: 'a' },
        { kind: 'deduction', status: 'accepted', createdAt: 'b' },
        { kind: 'property_complaint', status: 'rejected', createdAt: 'c' },
      ]),
    ).toEqual({ step: 'appeal' });
    expect(
      guestDepositNextStep([
        { kind: 'not_received', status: 'rejected', createdAt: 'a' },
        { kind: 'deduction', status: 'accepted', createdAt: 'b' },
        { kind: 'property_complaint', status: 'rejected', createdAt: 'c' },
        { kind: 'appeal', status: 'rejected', createdAt: 'd' },
      ]),
    ).toEqual({ step: 'site_complaint' });
    expect(
      guestDepositNextStep([
        { kind: 'not_received', status: 'rejected', createdAt: 'a' },
        { kind: 'property_complaint', status: 'open', createdAt: 'c' },
      ]),
    ).toEqual({ step: 'none' });
  });

  it('gives the site administration 30 calendar days to decide', () => {
    expect(siteDecisionDueFrom('2026-10-01T08:00:00.000Z')).toBe('2026-10-31T08:00:00.000Z');
  });

  it('opens guest requests on transfer or rejection, else two working weeks after the request', () => {
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
  });

  it('normalises WhatsApp digits and builds wa.me links', () => {
    expect(whatsappDigits('91234567')).toBe('96891234567');
    expect(whatsappLink('+968 9123 4567', 'hi')).toBe(
      'https://wa.me/96891234567?text=hi',
    );
  });
});
