import type { Metadata } from 'next';
import type { PublicPropertyDetail, PublicUnitDetail } from '@bhd-r/contracts';

export function publicWebOrigin(): string {
  return (
    process.env.PUBLIC_WEB_ORIGIN ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    'https://r.bhd-om.com'
  ).replace(/\/$/, '');
}

/** Canonical (locale-aware) + hreflang ar/en with x-default (Arabic preferred). */
export function bilingualAlternates(
  locale: string,
  pathWithoutLocale: string,
): Metadata['alternates'] {
  const path = pathWithoutLocale.startsWith('/') ? pathWithoutLocale : `/${pathWithoutLocale}`;
  const normalized = path === '/' ? '' : path;
  return {
    canonical: `/${locale}${normalized}`,
    languages: {
      ar: `/ar${normalized}`,
      en: `/en${normalized}`,
      'x-default': `/ar${normalized}`,
    },
  };
}

function moneyMajor(amountMinor: string, currency: string): string {
  const fractionDigits: Record<string, number> = { OMR: 3, BHD: 3, KWD: 3 };
  const digits = fractionDigits[currency] ?? 2;
  const raw = amountMinor.padStart(digits + 1, '0');
  return `${raw.slice(0, -digits)}.${raw.slice(-digits)}`;
}

export function unitListingJsonLd(input: {
  locale: string;
  unit: PublicUnitDetail;
  title: string;
  description: string;
}) {
  const origin = publicWebOrigin();
  const url = `${origin}/${input.locale}/units/${input.unit.unitId}`;
  const propertiesUrl = `${origin}/${input.locale}/properties`;
  const homeUrl = `${origin}/${input.locale}`;
  const price = moneyMajor(input.unit.rent.amountMinor, input.unit.rent.currency);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${origin}/#organization`,
        name: 'BHD R',
        url: origin,
        areaServed: 'OM',
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'BHD R', item: homeUrl },
          {
            '@type': 'ListItem',
            position: 2,
            name: input.locale === 'ar' ? 'العقارات' : 'Properties',
            item: propertiesUrl,
          },
          { '@type': 'ListItem', position: 3, name: input.title, item: url },
        ],
      },
      {
        '@type': 'RealEstateListing',
        '@id': `${url}#listing`,
        name: input.title,
        description: input.description || undefined,
        url,
        datePosted: undefined,
        image: input.unit.images.map((item) => item.url),
        about: {
          '@type': 'Apartment',
          name: input.title,
          numberOfBedrooms: input.unit.bedrooms,
          numberOfBathroomsTotal: input.unit.bathrooms,
          floorSize: input.unit.areaSquareMeters
            ? {
                '@type': 'QuantitativeValue',
                value: input.unit.areaSquareMeters,
                unitCode: 'MTK',
              }
            : undefined,
          address: {
            '@type': 'PostalAddress',
            addressCountry: 'OM',
            addressRegion: input.unit.governorate,
            addressLocality: `${input.unit.wilayat}, ${input.unit.city}`,
          },
        },
        offers: {
          '@type': 'Offer',
          price,
          priceCurrency: input.unit.rent.currency,
          availability: 'https://schema.org/InStock',
          url,
          businessFunction:
            input.unit.listingPurpose === 'sale'
              ? 'https://schema.org/SellAction'
              : 'https://schema.org/LeaseOutAction',
        },
        provider: { '@id': `${origin}/#organization` },
      },
    ],
  };
}

export function propertyListingJsonLd(input: {
  locale: string;
  property: PublicPropertyDetail;
  title: string;
  description: string;
}) {
  const origin = publicWebOrigin();
  const url = `${origin}/${input.locale}/properties/${input.property.id}`;
  const homeUrl = `${origin}/${input.locale}`;
  const propertiesUrl = `${origin}/${input.locale}/properties`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${origin}/#organization`,
        name: 'BHD R',
        url: origin,
        areaServed: 'OM',
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'BHD R', item: homeUrl },
          {
            '@type': 'ListItem',
            position: 2,
            name: input.locale === 'ar' ? 'العقارات' : 'Properties',
            item: propertiesUrl,
          },
          { '@type': 'ListItem', position: 3, name: input.title, item: url },
        ],
      },
      {
        '@type': 'RealEstateListing',
        '@id': `${url}#listing`,
        name: input.title,
        description: input.description || undefined,
        url,
        image: input.property.units
          .map((unit) => unit.coverImageUrl)
          .filter((value): value is string => Boolean(value)),
        about: {
          '@type': 'Residence',
          name: input.title,
          address: {
            '@type': 'PostalAddress',
            addressCountry: 'OM',
            addressRegion: input.property.governorate,
            addressLocality: input.property.wilayat,
          },
        },
        provider: { '@id': `${origin}/#organization` },
      },
    ],
  };
}

export const privatePortalRobots: Metadata['robots'] = {
  index: false,
  follow: false,
  nocache: true,
  googleBot: { index: false, follow: false, noimageindex: true },
};
