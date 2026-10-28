import { describe, expect, it } from 'vitest';
import { buildReservationActivityLog } from '@/lib/lease-reservation-timeline';

describe('buildReservationActivityLog', () => {
  it('orders newest first and labels docs return with actor', () => {
    const events = buildReservationActivityLog(
      [
        {
          id: '1',
          at: '2026-10-28T08:00:00.000Z',
          eventType: 'reservation.deposit_paid',
          fromStatus: null,
          toStatus: 'confirmed',
          note: null,
          actorName: null,
          metadata: {},
        },
        {
          id: '2',
          at: '2026-10-28T10:00:00.000Z',
          eventType: 'reservation.booking_docs_returned',
          fromStatus: null,
          toStatus: null,
          note: null,
          actorName: null,
          metadata: {
            byName: 'أحمد',
            note: 'أعد الهوية',
            rejected: ['id-front', 'civil_id_copy'],
            locked: ['selfie'],
          },
        },
      ],
      true,
    );

    expect(events[0]!.title).toContain('إرجاع');
    expect(events[0]!.by).toBe('أحمد');
    expect(events[0]!.detail).toContain('أعد الهوية');
    expect(events[0]!.detail).toContain('الهوية');
    expect(events[1]!.by).toBe('العميل');
  });
});
