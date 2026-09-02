import Image from 'next/image';
import { BrandMark } from '@bhd-r/ui';
import { Link } from '@/i18n/navigation';
import { formatMoney, localizedName } from '@/lib/format';
import { toPublicMediaSrc } from '@/lib/public-media-url';
import type { StayPublicDetail } from '@bhd-r/contracts';

export function StayPublicShowcase({
  detail,
  locale,
  preview = false,
}: {
  detail: StayPublicDetail;
  locale: string;
  /** Owner setup review — hide live navigation chrome. */
  preview?: boolean;
}) {
  const ar = locale === 'ar';
  const title = localizedName(locale, detail.titleAr, detail.titleEn);
  const propertyName = localizedName(
    locale,
    detail.propertyNameAr ?? '',
    detail.propertyNameEn ?? '',
  );
  const description = localizedName(
    locale,
    detail.descriptionAr ?? '',
    detail.descriptionEn ?? '',
  );
  const locationParts = [detail.city, detail.wilayat, detail.destination].filter(Boolean);
  const locationLine = locationParts.join(ar ? ' · ' : ', ');
  const images = (detail.imageUrls ?? [])
    .map((url) => toPublicMediaSrc(url))
    .filter(Boolean) as string[];
  const cover = toPublicMediaSrc(detail.coverImageUrl) ?? images[0] ?? null;
  const gallery = cover
    ? [cover, ...images.filter((url) => url !== cover)].slice(0, 6)
    : images.slice(0, 6);
  const priceLabel =
    detail.nightlyMinor && detail.currency
      ? formatMoney(detail.nightlyMinor, detail.currency, locale)
      : null;

  const policies = (() => {
    const splitLines = (text: string | null | undefined) =>
      text
        ?.split(/\r?\n/)
        .map((line) => line.replace(/^[\s•\-–—*]+/, '').trim())
        .filter(Boolean) ?? [];
    if (ar) {
      if (detail.policiesJson?.length) return detail.policiesJson;
      return splitLines(detail.policiesAr);
    }
    const enLines = splitLines(detail.policiesEn);
    if (enLines.length) return enLines;
    if (detail.policiesJson?.length) return detail.policiesJson;
    return splitLines(detail.policiesAr);
  })();

  return (
    <div className={`stay-showcase${preview ? ' stay-showcase--preview' : ''}`}>
      {preview ? (
        <p className="stay-showcase__preview-badge muted">
          {ar ? 'معاينة كما يراها الجمهور' : 'Guest-facing preview'}
        </p>
      ) : (
        <nav className="stay-showcase__crumb muted" aria-label={ar ? 'مسار التنقل' : 'Breadcrumb'}>
          <Link href="/stays">{ar ? 'الإقامات اليومية' : 'Daily stays'}</Link>
          {propertyName ? (
            <>
              <span aria-hidden="true"> › </span>
              {detail.propertyId ? (
                <Link href={`/properties/${detail.propertyId}`}>{propertyName}</Link>
              ) : (
                <span>{propertyName}</span>
              )}
            </>
          ) : null}
          {locationLine ? (
            <>
              <span aria-hidden="true"> › </span>
              <span>{locationLine}</span>
            </>
          ) : null}
        </nav>
      )}

      <div className="stay-showcase__hero">
        <div className="stay-showcase__gallery" aria-label={ar ? 'معرض الصور' : 'Photo gallery'}>
          {gallery.length ? (
            <>
              <div className="stay-showcase__gallery-main">
                <Image src={gallery[0]!} alt={title} fill sizes="(max-width: 960px) 100vw, 60vw" priority />
              </div>
              {gallery.length > 1 ? (
                <ul className="stay-showcase__gallery-thumbs">
                  {gallery.slice(1).map((src) => (
                    <li key={src}>
                      <Image src={src} alt="" fill sizes="120px" />
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <div className="stay-showcase__gallery-placeholder">
              <BrandMark tone="onDark" />
            </div>
          )}
        </div>

        <aside className="stay-showcase__facts card">
          <h1 className="stay-showcase__title">{title}</h1>
          {locationLine ? <p className="stay-showcase__location">{locationLine}</p> : null}
          {priceLabel ? (
            <p className="stay-showcase__price">
              {ar ? 'ابتداءً من' : 'From'}{' '}
              <strong dir="ltr">{priceLabel}</strong>{' '}
              {ar ? 'لليلة' : 'per night'}
            </p>
          ) : null}
          <dl className="stay-showcase__stats">
            {detail.maxGuests != null ? (
              <div>
                <dt>{ar ? 'الضيوف' : 'Guests'}</dt>
                <dd>{detail.maxGuests}</dd>
              </div>
            ) : null}
            {detail.dayUseMaxGuests != null ? (
              <div>
                <dt>{ar ? 'بدون مبيت' : 'Day use'}</dt>
                <dd>{detail.dayUseMaxGuests}</dd>
              </div>
            ) : null}
            {detail.overnightMaxGuests != null ? (
              <div>
                <dt>{ar ? 'مع المبيت' : 'Overnight'}</dt>
                <dd>{detail.overnightMaxGuests}</dd>
              </div>
            ) : null}
            {detail.bedrooms != null ? (
              <div>
                <dt>{ar ? 'غرف النوم' : 'Bedrooms'}</dt>
                <dd>{detail.bedrooms}</dd>
              </div>
            ) : null}
            {detail.bathrooms != null ? (
              <div>
                <dt>{ar ? 'الحمّامات' : 'Bathrooms'}</dt>
                <dd>{detail.bathrooms}</dd>
              </div>
            ) : null}
            {detail.areaSquareMeters != null ? (
              <div>
                <dt>{ar ? 'المساحة' : 'Area'}</dt>
                <dd dir="ltr">
                  {detail.areaSquareMeters} m²
                </dd>
              </div>
            ) : null}
            {detail.depositMinor && detail.currency ? (
              <div>
                <dt>{ar ? 'التأمين' : 'Deposit'}</dt>
                <dd dir="ltr">{formatMoney(detail.depositMinor, detail.currency, locale)}</dd>
              </div>
            ) : null}
          </dl>
          <dl className="stay-showcase__times">
            {detail.checkInFrom ? (
              <div>
                <dt>{ar ? 'وقت الدخول' : 'Check-in'}</dt>
                <dd dir="ltr">{detail.checkInFrom}</dd>
              </div>
            ) : null}
            {detail.dayUseCheckOutUntil ? (
              <div>
                <dt>{ar ? 'الخروج (بدون مبيت)' : 'Check-out (day use)'}</dt>
                <dd dir="ltr">{detail.dayUseCheckOutUntil}</dd>
              </div>
            ) : null}
            {(detail.overnightCheckOutUntil ?? detail.checkOutUntil) ? (
              <div>
                <dt>{ar ? 'الخروج (عند المبيت)' : 'Check-out (overnight)'}</dt>
                <dd dir="ltr">{detail.overnightCheckOutUntil ?? detail.checkOutUntil}</dd>
              </div>
            ) : null}
          </dl>
          {detail.unitId && !preview ? (
            <p className="stay-showcase__unit-link">
              <Link className="text-link" href={`/units/${detail.unitId}`}>
                {ar ? 'عرض تفاصيل الوحدة الكاملة' : 'View full unit listing'}
              </Link>
            </p>
          ) : null}
        </aside>
      </div>

      {description ? (
        <section className="stay-showcase__description card">
          <h2>{ar ? 'عن هذه الإقامة' : 'About this stay'}</h2>
          <p>{description}</p>
        </section>
      ) : null}

      {policies.length ? (
          <section className="stay-showcase__policies card">
            <h2>{ar ? 'السياسات' : 'Policies'}</h2>
            <ul>
              {policies.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
      ) : null}

      {!preview
        ? (() => {
            const instructions = localizedName(
              locale,
              detail.instructionsAr ?? '',
              detail.instructionsEn ?? '',
            );
            if (!instructions) return null;
            return (
              <section className="stay-showcase__instructions card">
                <h2>{ar ? 'التعليمات' : 'Instructions'}</h2>
                <p>{instructions}</p>
              </section>
            );
          })()
        : null}
    </div>
  );
}
