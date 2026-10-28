import { describe, expect, it } from 'vitest';
import {
  aggregateOfferingChannels,
  offeringChannelBadgeLabel,
  offeringChannelLabel,
  offeringChannelsFromPurposes,
  rowMatchesOfferingFilter,
  unitOfferingChannels,
} from '@/lib/property-offering-channels';

describe('property-offering-channels', () => {
  it('labels channels in Arabic', () => {
    expect(offeringChannelLabel('stay', 'ar')).toBe('إيجار يومي');
    expect(offeringChannelLabel('rent', 'ar')).toBe('عقد طويل');
    expect(offeringChannelLabel('sale', 'ar')).toBe('للبيع');
  });

  it('builds ordered channels from unit purposes and stay flag', () => {
    expect(offeringChannelsFromPurposes(['rent', 'sale'], true)).toEqual(['stay', 'rent', 'sale']);
    expect(offeringChannelsFromPurposes(['both'], false)).toEqual(['rent', 'sale']);
    expect(offeringChannelsFromPurposes([], true)).toEqual(['stay']);
  });

  it('keeps daily stay per unit and counts mixed multi-unit offerings', () => {
    expect(unitOfferingChannels('sale', true)).toEqual(['stay', 'sale']);
    expect(unitOfferingChannels('sale', false)).toEqual(['sale']);
    expect(unitOfferingChannels('both', false)).toEqual(['rent', 'sale']);

    const mixed = aggregateOfferingChannels([
      { purpose: 'sale', hasDailyStay: true },
      { purpose: 'sale', hasDailyStay: true },
      { purpose: 'sale', hasDailyStay: true },
      { purpose: 'sale', hasDailyStay: false },
      { purpose: 'sale', hasDailyStay: false },
      { purpose: 'both', hasDailyStay: false },
      { purpose: 'sale', hasDailyStay: false },
    ]);
    expect(mixed.channels).toEqual(['stay', 'rent', 'sale']);
    expect(mixed.counts).toEqual({ stay: 3, rent: 1, sale: 7 });
    expect(offeringChannelBadgeLabel('stay', 'ar', 3)).toBe('إيجار يومي · 3');
  });

  it('filters rows by channel', () => {
    expect(rowMatchesOfferingFilter(['stay', 'rent'], 'all')).toBe(true);
    expect(rowMatchesOfferingFilter(['stay', 'rent'], 'sale')).toBe(false);
    expect(rowMatchesOfferingFilter(['stay', 'rent'], 'stay')).toBe(true);
  });
});
