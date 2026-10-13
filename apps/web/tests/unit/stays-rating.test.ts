import { describe, expect, it } from 'vitest';
import { reviewCountLabel } from '@/components/stays/stay-rating-badge';
import {
  EMPTY_STAY_BROWSE_FILTERS,
  applyStayBrowseFilters,
  stayFiltersFromSearchRecord,
} from '@/lib/stays-browse-filters';
import type { StayCatalogueListing } from '@/lib/stays-catalogue-listing';

function listing(id: string, rating: { score: number; count: number } | null, publishedAt: string) {
  return {
    id,
    slug: id,
    unitId: id,
    unitCode: id,
    unitNameAr: id,
    unitNameEn: id,
    propertyId: 'p',
    propertyNameAr: 'p',
    propertyNameEn: 'p',
    propertyKind: 'multi_unit',
    category: 'apartment',
    governorate: 'Muscat',
    wilayat: 'Muttrah',
    bedrooms: 2,
    bathrooms: 2,
    areaSquareMeters: 100,
    maxGuests: 4,
    nightlyMinor: '80000',
    currency: 'OMR',
    coverImageUrl: null,
    publishedAt,
    rating,
  } satisfies StayCatalogueListing;
}

describe('stay ratings in search', () => {
  const items: StayCatalogueListing[] = [
    listing('new', null, '2026-10-12T00:00:00Z'),
    listing('good', { score: 7.4, count: 9 }, '2026-10-01T00:00:00Z'),
    listing('best-few', { score: 9.2, count: 1 }, '2026-09-01T00:00:00Z'),
    listing('best-many', { score: 9.2, count: 12 }, '2026-08-01T00:00:00Z'),
  ];

  it('sorts top rated first, more reviews break ties, unrated last', () => {
    const sorted = applyStayBrowseFilters(items, {
      ...EMPTY_STAY_BROWSE_FILTERS,
      sort: 'rating_desc',
    });
    expect(sorted.map((item) => item.id)).toEqual(['best-many', 'best-few', 'good', 'new']);
  });

  it('reads the rating sort from the URL', () => {
    expect(stayFiltersFromSearchRecord({ sort: 'rating_desc' }).sort).toBe('rating_desc');
    expect(stayFiltersFromSearchRecord({ sort: 'bogus' }).sort).toBe('newest');
  });

  it('counts reviews in correct Arabic', () => {
    expect([1, 2, 3, 10, 11, 100].map((n) => reviewCountLabel(n, true))).toEqual([
      'تقييم واحد',
      'تقييمان',
      '3 تقييمات',
      '10 تقييمات',
      '11 تقييماً',
      '100 تقييماً',
    ]);
    expect(reviewCountLabel(1, false)).toBe('1 review');
    expect(reviewCountLabel(4, false)).toBe('4 reviews');
  });
});
