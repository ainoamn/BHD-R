import type { MetadataRoute } from 'next';
import { publicApiFetch } from '@/lib/server-api';
import type { ListingCollection } from '@/lib/types';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base =
    process.env.PUBLIC_WEB_ORIGIN ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://r.bhd-om.com';
  const pages = ['', '/properties', '/trust', '/privacy', '/terms', '/accessibility'];
  const staticEntries = ['ar', 'en'].flatMap((locale) =>
    pages.map((page) => ({
      url: `${base}/${locale}${page}`,
      changeFrequency: page === '/properties' ? ('hourly' as const) : ('monthly' as const),
      priority: page === '' ? 1 : 0.7,
    })),
  );
  const listingRows: ListingCollection['data'] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ locale: 'en', limit: '50' });
    if (cursor) query.set('cursor', cursor);
    const listings = await publicApiFetch<ListingCollection>(
      `/v1/public/listings?${query.toString()}`,
      300,
    ).catch(() => ({ data: [], pagination: { nextCursor: null, hasMore: false } }));
    listingRows.push(...listings.data);
    cursor = listings.pagination.nextCursor;
    if (!listings.pagination.hasMore || !cursor) break;
  }
  return [
    ...staticEntries,
    ...listingRows.flatMap((listing) =>
      ['ar', 'en'].map((locale) => ({
        url: `${base}/${locale}/units/${listing.unitId}`,
        lastModified: new Date(listing.publishedAt),
        changeFrequency: 'daily' as const,
        priority: 0.8,
      })),
    ),
    ...[...new Map(listingRows.map((listing) => [listing.propertyId, listing])).values()].flatMap(
      (listing) =>
        ['ar', 'en'].map((locale) => ({
          url: `${base}/${locale}/properties/${listing.propertyId}`,
          lastModified: new Date(listing.publishedAt),
          changeFrequency: 'daily' as const,
          priority: 0.75,
        })),
    ),
  ];
}
