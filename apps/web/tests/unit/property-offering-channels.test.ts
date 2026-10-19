import { describe, expect, it } from 'vitest';
import {
  offeringChannelLabel,
  offeringChannelsFromPurposes,
  rowMatchesOfferingFilter,
} from '@/lib/property-offering-channels';

describe('property-offering-channels', () => {
  it('labels channels in Arabic', () => {
    expect(offeringChannelLabel('stay', 'ar')).toBe('إيجار يومي');
    expect(offeringChannelLabel('rent', 'ar')).toBe('عقد طويل');
    expect(offeringChannelLabel('sale', 'ar')).toBe('للبيع');
  });

  it('builds ordered channels from unit purposes and stay flag', () => {
    expect(offeringChannelsFromPurposes(['rent', 'sale'], true)).toEqual([
      'stay',
      'rent',
      'sale',
    ]);
    expect(offeringChannelsFromPurposes(['both'], false)).toEqual(['rent', 'sale']);
    expect(offeringChannelsFromPurposes([], true)).toEqual(['stay']);
  });

  it('filters rows by channel', () => {
    expect(rowMatchesOfferingFilter(['stay', 'rent'], 'all')).toBe(true);
    expect(rowMatchesOfferingFilter(['stay', 'rent'], 'sale')).toBe(false);
    expect(rowMatchesOfferingFilter(['stay', 'rent'], 'stay')).toBe(true);
  });
});
