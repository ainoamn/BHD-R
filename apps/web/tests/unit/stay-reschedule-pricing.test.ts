import { describe, expect, it } from 'vitest';
import { stayRescheduleCharge } from '@/lib/stay-reschedule-pricing';

describe('stayRescheduleCharge', () => {
  it('keeps the original price and forfeits the difference when the new dates are cheaper', () => {
    expect(
      stayRescheduleCharge({
        originalTotalMinor: '160000',
        quotedTotalMinor: '120000',
        paid: true,
      }),
    ).toEqual({
      originalTotalMinor: '160000',
      quotedTotalMinor: '120000',
      chargedTotalMinor: '160000',
      forfeitedMinor: '40000',
      extraDueMinor: '0',
      keptOriginalPrice: true,
      requiresPayment: false,
    });
  });

  it('takes the calendar price when the new dates cost more on an unpaid booking', () => {
    const charge = stayRescheduleCharge({
      originalTotalMinor: '160000',
      quotedTotalMinor: '200000',
      paid: false,
    });
    expect(charge.chargedTotalMinor).toBe('200000');
    expect(charge.extraDueMinor).toBe('40000');
    expect(charge.keptOriginalPrice).toBe(false);
    expect(charge.requiresPayment).toBe(false);
  });

  it('flags a paid booking whose new dates cost more as requiring payment', () => {
    const charge = stayRescheduleCharge({
      originalTotalMinor: '160000',
      quotedTotalMinor: '200000',
      paid: true,
    });
    expect(charge.requiresPayment).toBe(true);
  });

  it('charges the same amount when the price is unchanged', () => {
    const charge = stayRescheduleCharge({
      originalTotalMinor: '160000',
      quotedTotalMinor: '160000',
      paid: true,
    });
    expect(charge).toMatchObject({
      chargedTotalMinor: '160000',
      forfeitedMinor: '0',
      extraDueMinor: '0',
      keptOriginalPrice: false,
      requiresPayment: false,
    });
  });

  it('rejects non-integer amounts', () => {
    expect(() =>
      stayRescheduleCharge({ originalTotalMinor: '1.5', quotedTotalMinor: '1', paid: false }),
    ).toThrow(RangeError);
  });
});
