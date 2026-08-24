import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { Card, CardContent, StatusBadge } from '@bhd-r/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ApiError, publicApiFetch } from '@/lib/server-api';
import { formatMoney, localizedName } from '@/lib/format';
import { PublicViewingForm } from '@/components/public-viewing-form';
import type { PublicUnitDetail } from '@bhd-r/contracts';

async function getUnit(id: string): Promise<PublicUnitDetail | null> {
  try {
    return await publicApiFetch<PublicUnitDetail>(`/v1/public/units/${encodeURIComponent(id)}`, 30);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 410)) return null;
    throw error;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; unitId: string }>;
}): Promise<Metadata> {
  const { locale, unitId } = await params;
  const unit = await getUnit(unitId).catch(() => null);
  if (!unit)
    return {
      title: locale === 'ar' ? 'الوحدة غير متاحة' : 'Unit unavailable',
      robots: { index: false, follow: false },
      openGraph: { images: [] },
      twitter: { images: [] },
    };
  const title = `${localizedName(locale, unit.propertyNameAr, unit.propertyNameEn)} — ${localizedName(locale, unit.unitNameAr, unit.unitNameEn)}`;
  const description =
    localizedName(locale, unit.descriptionAr ?? '', unit.descriptionEn ?? '') ||
    `${unit.governorate}, ${unit.wilayat}`;
  const image = unit.images[0]?.url;
  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}/units/${unit.unitId}`,
      languages: {
        ar: `/ar/units/${unit.unitId}`,
        en: `/en/units/${unit.unitId}`,
      },
    },
    openGraph: {
      title,
      description,
      url: `/${locale}/units/${unit.unitId}`,
      type: 'website',
      images: image ? [{ url: image }] : [],
    },
    twitter: { title, description, images: image ? [image] : [] },
  };
}

export default async function UnitPage({
  params,
}: {
  params: Promise<{ locale: string; unitId: string }>;
}) {
  const { locale, unitId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const unit = await getUnit(unitId);
  if (!unit) notFound();
  const title = `${localizedName(locale, unit.propertyNameAr, unit.propertyNameEn)} — ${localizedName(locale, unit.unitNameAr, unit.unitNameEn)}`;
  const description = localizedName(locale, unit.descriptionAr ?? '', unit.descriptionEn ?? '');
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const publicOrigin = (
    process.env.PUBLIC_WEB_ORIGIN ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    'https://r.bhd-om.com'
  ).replace(/\/$/, '');
  const fractionDigits: Record<string, number> = { OMR: 3, BHD: 3, KWD: 3 };
  const digits = fractionDigits[unit.rent.currency] ?? 2;
  const rawAmount = unit.rent.amountMinor.padStart(digits + 1, '0');
  const price = `${rawAmount.slice(0, -digits)}.${rawAmount.slice(-digits)}`;
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'Apartment',
    name: title,
    description: description || undefined,
    url: `${publicOrigin}/${locale}/units/${unit.unitId}`,
    image: unit.images.map((item) => item.url),
    address: {
      '@type': 'PostalAddress',
      addressCountry: 'OM',
      addressRegion: unit.governorate,
      addressLocality: `${unit.wilayat}, ${unit.city}`,
    },
    numberOfBedrooms: unit.bedrooms,
    numberOfBathroomsTotal: unit.bathrooms,
    floorSize: unit.areaSquareMeters
      ? { '@type': 'QuantitativeValue', value: unit.areaSquareMeters, unitCode: 'MTK' }
      : undefined,
    offers: {
      '@type': 'Offer',
      price,
      priceCurrency: unit.rent.currency,
      availability: 'https://schema.org/InStock',
      url: `${publicOrigin}/${locale}/units/${unit.unitId}`,
    },
  };
  return (
    <>
      <header className="page-hero">
        <div className="container">
          <StatusBadge status="positive" label={t('Property.available')} />
          <h1>{title}</h1>
          <p>
            {unit.governorate} · {unit.wilayat} · {unit.city}
          </p>
        </div>
      </header>
      <section className="section">
        <div className="container detail-grid">
          <div>
            <div className="gallery">
              {unit.images[0] ? (
                <Image
                  src={unit.images[0].url}
                  alt={(locale === 'ar' ? unit.images[0].altAr : unit.images[0].altEn) ?? title}
                  width={1200}
                  height={750}
                  priority
                />
              ) : (
                <div className="gallery__placeholder" aria-hidden="true">
                  R
                </div>
              )}
              {unit.images[1] ? (
                <Image
                  src={unit.images[1].url}
                  alt={(locale === 'ar' ? unit.images[1].altAr : unit.images[1].altEn) ?? title}
                  width={600}
                  height={750}
                />
              ) : null}
            </div>
            <Card>
              <CardContent>
                <h2>{t('Property.details')}</h2>
                <dl className="detail-facts">
                  <div>
                    <dt>{t('Property.unitCode')}</dt>
                    <dd>{unit.code}</dd>
                  </div>
                  <div>
                    <dt>{t('Property.beds')}</dt>
                    <dd>{unit.bedrooms}</dd>
                  </div>
                  <div>
                    <dt>{t('Property.baths')}</dt>
                    <dd>{unit.bathrooms}</dd>
                  </div>
                  {unit.areaSquareMeters ? (
                    <div>
                      <dt>{t('Property.area')}</dt>
                      <dd>{unit.areaSquareMeters} m²</dd>
                    </div>
                  ) : null}
                </dl>
                {description ? <p>{description}</p> : null}
                <p className="muted">{t('Property.watermark')}</p>
              </CardContent>
            </Card>
          </div>
          <aside>
            <Card className="price-panel">
              <CardContent>
                <p>{t('Property.available')}</p>
                <h2>
                  {formatMoney(unit.rent.amountMinor, unit.rent.currency, locale)}{' '}
                  <small>{t('Common.monthly')}</small>
                </h2>
                <PublicViewingForm unitId={unit.unitId} locale={locale} />
              </CardContent>
            </Card>
          </aside>
        </div>
      </section>
      <script type="application/ld+json" nonce={nonce}>
        {JSON.stringify(structuredData).replaceAll('<', '\\u003c')}
      </script>
    </>
  );
}
