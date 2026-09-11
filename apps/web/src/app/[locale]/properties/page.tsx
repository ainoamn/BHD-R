import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PropertiesBrowse } from '@/components/properties-browse';
import { isStaysPublicSurfaceEnabled } from '@/lib/stays-flags';
import {
  filtersFromSearchRecord,
  type BrowseFilterState,
} from '@/lib/properties-browse-filters';
import { bilingualAlternates } from '@/lib/seo';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === 'ar' ? 'العقارات المتاحة' : 'Available properties',
    description:
      locale === 'ar'
        ? 'وحدات منشورة ومتاحة فعلياً للإيجار والبيع عبر BHD R.'
        : 'Live, publicly available properties for rent and sale through BHD R.',
    alternates: bilingualAlternates(locale, '/properties'),
  };
}

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parsePurpose(value: string | undefined): 'rent' | 'sale' | undefined {
  return value === 'rent' || value === 'sale' ? value : undefined;
}

/**
 * Paint the browse shell immediately. Catalogue data loads client-side with
 * retry so soft-nav never sits on loading.tsx for tens of seconds waiting on Neon.
 */
export default async function PropertiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const raw = await searchParams;
  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    flat[key] = one(value);
  }
  const initialFilters: BrowseFilterState = filtersFromSearchRecord(flat);
  const t = await getTranslations();
  const purpose = parsePurpose(initialFilters.purpose || undefined);
  const heading =
    purpose === 'rent'
      ? locale === 'ar'
        ? 'عقارات للإيجار'
        : 'Properties for rent'
      : purpose === 'sale'
        ? locale === 'ar'
          ? 'عقارات للبيع'
          : 'Properties for sale'
        : t('Nav.available');

  return (
    <PropertiesBrowse
      locale={locale}
      heading={heading}
      hint={t('Home.featuredHint')}
      initialFilters={initialFilters}
      initialListings={[]}
      staysEnabled={isStaysPublicSurfaceEnabled()}
    />
  );
}
