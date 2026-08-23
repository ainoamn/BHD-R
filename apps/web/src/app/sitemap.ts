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
  const listings = await publicApiFetch<ListingCollection>(
    '/v1/public/listings?locale=en&limit=50',
    300,
  ).catch(() => ({ data: [], pagination: { nextCursor: null, hasMore: false } }));
  return [
    ...staticEntries,
    ...listings.data.flatMap((listing) =>
      ['ar', 'en'].map((locale) => ({
        url: `${base}/${locale}/units/${listing.unitId}`,
        lastModified: new Date(listing.publishedAt),
        changeFrequency: 'daily' as const,
        priority: 0.8,
      })),
    ),
  ];
}
