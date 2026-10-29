import { describe, expect, it } from 'vitest';
import {
  buildStayBookingTimeline,
  type StayBookingTimelineFacts,
} from '@/lib/stay-booking-timeline';
import type { DepositRefundView } from '@/lib/stay-deposit-refund';

const NOW = Date.parse('2026-10-13T12:00:00Z');

const stamp = (at: string) => ({
  at,
  notes: null,
  recordedBy: 'Host',
  noteKeys: [],
  customNote: null,
  important: false,
  recipient: null,
  photos: [],
});

const refund = (over: Partial<DepositRefundView>): DepositRefundView => ({
  id: 'r1',
  status: 'executed',
  amountMinor: '60000',
  currency: 'OMR',
  requestedAt: '2026-10-12T06:52:00Z',
  requestedBy: 'guest',
  consent: null,
  guestNote: null,
  guestPayout: null,
  decidedAt: '2026-10-12T07:25:00Z',
  decidedBy: 'Host',
  decisionNote: 'deduct 20',
  transfer: {
    method: 'bank',
    account: '5121212120',
    bank: 'Bank Muscat',
    holder: null,
    at: '2026-10-13T05:57:00Z',
    reference: null,
    recordedBy: 'Accountant',
    hasReceipt: true,
    amountMinor: '60000',
  },
  settledDepositMinor: '80000',
  paidMinor: '60000',
  transferRecordedAt: '2026-10-13T05:58:00Z',
  guestReceipt: null,
  guestReceiptAt: null,
  ...over,
});

const hist = (
  over: Partial<StayBookingTimelineFacts['history'][number]> &
    Pick<StayBookingTimelineFacts['history'][number], 'at' | 'toStatus'>,
): StayBookingTimelineFacts['history'][number] => ({
  fromStatus: null,
  reason: null,
  by: null,
  note: null,
  detail: null,
  ...over,
});

const facts = (over: Partial<StayBookingTimelineFacts>): StayBookingTimelineFacts => ({
  history: [
    hist({
      at: '2026-10-08T07:32:00Z',
      toStatus: 'request_pending',
      reason: 'public_booking_created',
    }),
    hist({
      at: '2026-10-12T04:42:00Z',
      toStatus: 'confirmed',
      reason: 'Owner approved',
      by: 'Host',
    }),
  ],
  payments: [],
  checkIn: null,
  checkOut: null,
  depositMinor: '80000',
  refund: null,
  claims: [],
  reviews: [],
  ...over,
});

function build(status: string, input: StayBookingTimelineFacts) {
  return buildStayBookingTimeline(
    {
      bookingId: 'b1',
      propertyId: 'p1',
      status,
      bookingMode: 'request',
      createdAt: '2026-10-08T07:32:00Z',
      facts: input,
      portal: 'owner',
    },
    true,
    (minor) => `${Number(minor) / 100} OMR`,
    (iso) => iso,
    NOW,
  );
}

const current = (timeline: ReturnType<typeof build>) =>
  timeline.steps.find((step) => step.state === 'current')?.key ?? null;

describe('buildStayBookingTimeline', () => {
  it('asks the host to record check-in once the request is approved', () => {
    const timeline = build('confirmed', facts({}));
    expect(current(timeline)).toBe('check-in');
    expect(timeline.next?.href).toBe('/owner/properties/p1?section=bookings&focus=b1');
    expect(timeline.events.map((event) => event.title)).toEqual([
      'اعتُمد طلب الحجز',
      'أُنشئ الحجز',
    ]);
  });

  it('asks for the guest review after check-out, linking to the review form', () => {
    const timeline = build(
      'checked_out',
      facts({ checkIn: stamp('2026-10-09T04:43:00Z'), checkOut: stamp('2026-10-09T05:30:00Z') }),
    );
    expect(current(timeline)).toBe('deposit');
    expect(timeline.next?.href).toContain('&review=1');
    expect(timeline.next?.label).toBe('قيّم الضيف ثم قرّر في استرداد التأمين');
  });

  it('waits for the guest receipt within 24 hours of the transfer', () => {
    const timeline = build(
      'closed',
      facts({
        checkIn: stamp('2026-10-09T04:43:00Z'),
        checkOut: stamp('2026-10-09T05:30:00Z'),
        refund: refund({}),
        reviews: [
          {
            direction: 'host_to_guest',
            score: 6.8,
            createdAt: '2026-10-13T06:00:00Z',
            released: false,
          },
        ],
      }),
    );
    expect(current(timeline)).toBe('deposit');
    expect(timeline.waiting.join(' ')).toContain('تأكيد الاستلام اختياري');
    expect(timeline.events.some((event) => event.title.includes('••••2120'))).toBe(true);
  });

  it('completes every stage once receipt is confirmed and the host reviewed', () => {
    const timeline = build(
      'closed',
      facts({
        checkIn: stamp('2026-10-09T04:43:00Z'),
        checkOut: stamp('2026-10-09T05:30:00Z'),
        refund: refund({ guestReceipt: 'confirmed', guestReceiptAt: '2026-10-13T06:45:00Z' }),
        reviews: [
          {
            direction: 'host_to_guest',
            score: 6.8,
            createdAt: '2026-10-13T10:30:00Z',
            released: true,
          },
          {
            direction: 'guest_to_host',
            score: 8.6,
            createdAt: '2026-10-13T06:21:00Z',
            released: true,
          },
        ],
      }),
    );
    expect(timeline.steps.every((step) => step.state === 'done')).toBe(true);
    expect(timeline.next).toBeNull();
    expect(timeline.waiting).toEqual([]);
    expect(timeline.events[0]?.title).toBe('قُيّم الضيف 6.8 من 10');
  });

  it('counts the receipt as confirmed 24 hours after the transfer', () => {
    const timeline = build(
      'closed',
      facts({ refund: refund({ transferRecordedAt: '2026-10-12T05:00:00Z' }) }),
    );
    expect(timeline.events.some((event) => event.key === 'refund-receipt')).toBe(true);
    expect(timeline.steps.find((step) => step.key === 'deposit')?.state).toBe('done');
  });

  it('shows no stages for a cancelled booking but keeps its log', () => {
    const timeline = build(
      'cancelled',
      facts({
        history: [
          hist({ at: '2026-10-08T07:32:00Z', toStatus: 'request_pending' }),
          hist({
            at: '2026-10-09T07:32:00Z',
            toStatus: 'cancelled',
            reason: 'host_cancelled',
          }),
        ],
      }),
    );
    expect(timeline.steps).toEqual([]);
    expect(timeline.events[0]?.title).toBe('أُلغي الحجز');
    expect(timeline.events[0]?.detail).toBeNull();
  });
});
