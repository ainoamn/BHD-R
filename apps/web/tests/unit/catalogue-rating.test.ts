import { describe, expect, it } from 'vitest';
import { catalogueRating, type CatalogueListing } from '@/lib/listing-market-status';

const listing = (avgRating: number | null | undefined, reviewCount?: number) =>
  ({ avgRating, reviewCount }) as unknown as CatalogueListing;

describe('catalogueRating', () => {
  it('returns the released guest score and count', () => {
    expect(catalogueRating(listing(8.6, 1))).toEqual({ score: 8.6, count: 1 });
  });

  it('hides the badge when nothing was released', () => {
    expect(catalogueRating(listing(null, 0))).toBeNull();
    expect(catalogueRating(listing(undefined))).toBeNull();
    expect(catalogueRating(listing(8.6, 0))).toBeNull();
    expect(catalogueRating(listing(0, 3))).toBeNull();
  });
});
