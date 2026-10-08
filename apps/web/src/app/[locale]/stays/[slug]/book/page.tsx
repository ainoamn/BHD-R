import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { StayCheckout } from '@/components/stays/stay-checkout';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadBookingContacts, type BookingContactsForViewer } from '@/lib/booking-contacts-neon';
import { loadBookingTermsForUnit } from '@/lib/booking-terms-neon';
import { formatMoney, localizedName } from '@/lib/format';
import { loadPublicStayBySlugOnNeon } from '@/lib/load-public-stays-neon';
import { toPublicMediaSrc } from '@/lib/public-media-url';
import { isStaysPublicSurfaceEnabled } from '@/lib/stays-flags';
import { publicApiFetch } from '@/lib/server-api';
import { getViewer } from '@/lib/viewer';
import { withTimedResult } from '@/lib/with-timeout';
import type { StayPublicDetail } from '@bhd-r/contracts';

type StayType = 'overnight_stay' | 'day_use' | 'overnight_only';

function pickQuery(
  query: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const raw = query[key];
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].trim()) return raw[0].trim();
  return undefined;
}

/** Arabic counted noun: 1 and 2 take dedicated forms, 3–10 plural, 11+ singular accusative. */
function arCount(n: number, one: string, two: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  return `${n} ${n <= 10 ? few : many}`;
}

/** "14:00:00" → "14:00"; anything unexpected is hidden. */
function shortTime(value: string | null | undefined): string | null {
  const match = value?.trim().match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1]!.padStart(2, '0')}:${match[2]}` : null;
}

function parseStayType(value: string | undefined): StayType | undefined {
  if (value === 'day_use' || value === 'overnight_only' || value === 'overnight_stay') return value;
  return undefined;
}

async function loadStayDetail(slug: string, unitId?: string): Promise<StayPublicDetail | null> {
  if (hasDatabaseUrl()) {
    try {
      const neon = await loadPublicStayBySlugOnNeon(slug, unitId ?? null);
      if (neon) return neon;
    } catch (error) {
      console.error('Neon public stay load failed', error);
    }
  }
  const qs = unitId ? `?unitId=${encodeURIComponent(unitId)}` : '';
  return publicApiFetch<StayPublicDetail>(
    `/v1/public/stays/${encodeURIComponent(slug)}${qs}`,
    8,
  ).catch(() => null);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const detail = await loadStayDetail(slug).catch(() => null);
  const title = detail
    ? localizedName(locale, detail.titleAr, detail.titleEn)
    : locale === 'ar'
      ? 'إكمال الحجز'
      : 'Complete booking';
  return {
    title: locale === 'ar' ? `حجز — ${title}` : `Book — ${title}`,
    robots: { index: false, follow: false },
  };
}

export default async function StayBookPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isStaysPublicSurfaceEnabled()) notFound();
  const { locale: rawLocale, slug } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  const query = await searchParams;
  setRequestLocale(locale);
  const ar = locale === 'ar';
  const unitId = pickQuery(query, 'unit') ?? pickQuery(query, 'unitId');

  const [detail, viewer] = await Promise.all([loadStayDetail(slug, unitId), getViewer()]);
  if (!detail) notFound();

  const title = localizedName(locale, detail.titleAr, detail.titleEn);
  const cover = toPublicMediaSrc(detail.coverImageUrl) ?? detail.coverImageUrl ?? null;
  const stayType = parseStayType(pickQuery(query, 'stayType'));
  const bookingUnitId = detail.unitId ?? unitId;
  const [termsResult, contactsResult] = await Promise.all([
    bookingUnitId && hasDatabaseUrl()
      ? withTimedResult(loadBookingTermsForUnit(bookingUnitId, ['daily']), 5_000, 'stay-terms')
      : null,
    viewer && hasDatabaseUrl()
      ? withTimedResult(
          loadBookingContacts({
            userId: viewer.id,
            organizationId: viewer.organizationId ?? null,
            partyId: viewer.partyId ?? null,
            roles: viewer.roles,
            permissions: viewer.permissions,
            email: viewer.email ?? null,
            displayName: viewer.displayName,
          }),
          4_000,
          'stay-book-contacts',
        )
      : null,
  ]);
  const dailyTerms = termsResult?.status === 'ok' ? (termsResult.value.daily ?? null) : null;
  const contacts: BookingContactsForViewer | null = viewer
    ? contactsResult?.status === 'ok'
      ? contactsResult.value
      : {
          self: {
            fullName: viewer.displayName?.trim() ?? '',
            phone: null,
            email: viewer.email?.trim() || null,
          },
          saved: [],
          canSave: false,
        }
    : null;

  const switchQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === 'string' && first) switchQuery.set(key, first);
  }
  const switchQs = switchQuery.toString();
  const otherLocale = ar ? 'en' : 'ar';
  const stayHref = `/stays/${encodeURIComponent(slug)}${unitId ? `?unit=${encodeURIComponent(unitId)}` : ''}`;
  const currency = detail.currency ?? 'OMR';
  const location = [detail.city, detail.wilayat, detail.destination]
    .map((part) => part?.trim())
    .filter((part, index, all): part is string => Boolean(part) && all.indexOf(part) === index)
    .slice(0, 2)
    .join(ar ? '، ' : ', ');
  const facts = [
    detail.bedrooms
      ? ar
        ? arCount(detail.bedrooms, 'غرفة نوم', 'غرفتا نوم', 'غرف نوم', 'غرفة نوم')
        : `${detail.bedrooms} ${detail.bedrooms === 1 ? 'bedroom' : 'bedrooms'}`
      : null,
    detail.bathrooms
      ? ar
        ? arCount(detail.bathrooms, 'دورة مياه', 'دورتا مياه', 'دورات مياه', 'دورة مياه')
        : `${detail.bathrooms} ${detail.bathrooms === 1 ? 'bath' : 'baths'}`
      : null,
    detail.maxGuests
      ? ar
        ? `حتى ${arCount(detail.maxGuests, 'ضيف واحد', 'ضيفين', 'ضيوف', 'ضيفاً')}`
        : `Up to ${detail.maxGuests} ${detail.maxGuests === 1 ? 'guest' : 'guests'}`
      : null,
    detail.areaSquareMeters
      ? ar
        ? `${Math.round(detail.areaSquareMeters)} م²`
        : `${Math.round(detail.areaSquareMeters)} m²`
      : null,
  ].filter((fact): fact is string => Boolean(fact));
  const checkInFrom = shortTime(detail.checkInFrom);
  const checkOutUntil = shortTime(detail.checkOutUntil);
  const reviewCount = detail.stayReviewCount ?? 0;
  const score = reviewCount > 0 ? (detail.guestScoreTen ?? detail.smartScoreTen ?? null) : null;

  return (
    <section className="stay-book" data-stay-book-immersive="true">
      <header className="stay-book__bar">
        <div className="stay-book__bar-inner">
          <Link className="stay-book__back" href={stayHref}>
            <span aria-hidden="true">{ar ? '→' : '←'}</span>
            {ar ? 'العودة للإقامة' : 'Back to stay'}
          </Link>
          <span className="stay-book__brand logo__product" aria-label="BHD R">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/bhd-official-symbol.svg" alt="" width="96" height="32" />
            <i>R</i>
          </span>
          <Link
            className="stay-book__lang"
            href={`/stays/${encodeURIComponent(slug)}/book${switchQs ? `?${switchQs}` : ''}`}
            locale={otherLocale}
            hrefLang={otherLocale}
            lang={otherLocale}
            aria-label={ar ? 'Switch to English' : 'التبديل إلى العربية'}
          >
            {ar ? 'English' : 'العربية'}
          </Link>
        </div>
      </header>

      <div className="stay-book__layout">
        <aside className="stay-book__summary" aria-label={ar ? 'ملخص الإقامة' : 'Stay summary'}>
          <div className="stay-book__media">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover} alt="" />
            ) : (
              <span className="stay-book__media-fallback logo__product logo__product--on-dark">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/bhd-official-symbol.svg" alt="" width="96" height="32" />
              </span>
            )}
            {score !== null && score > 0 ? (
              <p className="stay-book__score">
                <strong>{score.toFixed(1)}</strong>
                <small>
                  {ar ? `من 10 · ${reviewCount} تقييم` : `/ 10 · ${reviewCount} reviews`}
                </small>
              </p>
            ) : null}
          </div>

          <div className="stay-book__info">
            <p className="stay-book__eyebrow">
              {ar ? 'إقامة يومية' : 'Daily stay'}
              {location ? <span>{location}</span> : null}
            </p>
            <h1 className="stay-book__title">{title}</h1>
            {facts.length ? (
              <ul className="stay-book__facts">
                {facts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
            ) : null}
            {detail.nightlyMinor ? (
              <p className="stay-book__price">
                <small>{ar ? 'تبدأ من' : 'From'}</small>
                <strong dir="ltr">{formatMoney(detail.nightlyMinor, currency, locale)}</strong>
                <small>{ar ? '/ الليلة' : '/ night'}</small>
              </p>
            ) : null}
          </div>

          <div className="stay-book__extra">
            {checkInFrom || checkOutUntil ? (
              <dl className="stay-book__times">
                {checkInFrom ? (
                  <div>
                    <dt>{ar ? 'الوصول من' : 'Check-in from'}</dt>
                    <dd dir="ltr">{checkInFrom}</dd>
                  </div>
                ) : null}
                {checkOutUntil ? (
                  <div>
                    <dt>{ar ? 'المغادرة حتى' : 'Check-out by'}</dt>
                    <dd dir="ltr">{checkOutUntil}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
            <ul className="stay-book__trust">
              <li>{ar ? 'دفع آمن' : 'Secure payment'}</li>
              <li>{ar ? 'تأكيد فوري بعد الدفع' : 'Instant confirmation'}</li>
              <li>{ar ? 'عقد إلكتروني' : 'Online contract'}</li>
            </ul>
          </div>
        </aside>

        <div className="stay-book__panel">
          <StayCheckout
            locale={locale}
            slug={slug}
            title={title}
            {...(bookingUnitId ? { unitId: bookingUnitId } : {})}
            terms={dailyTerms}
            contacts={contacts}
            offer={{
              currency,
              nightlyMinor: detail.nightlyMinor ?? null,
              dayUseMinor: detail.dayUseMinor ?? null,
              overnightOnlyMinor: detail.overnightOnlyMinor ?? null,
              maxGuests: detail.maxGuests ?? null,
            }}
            defaults={{
              ...(pickQuery(query, 'checkInOn')
                ? { checkInOn: pickQuery(query, 'checkInOn')! }
                : {}),
              ...(pickQuery(query, 'checkOutOn')
                ? { checkOutOn: pickQuery(query, 'checkOutOn')! }
                : {}),
              ...(pickQuery(query, 'adults') ? { adults: pickQuery(query, 'adults')! } : {}),
              ...(pickQuery(query, 'children') ? { children: pickQuery(query, 'children')! } : {}),
              ...(stayType ? { stayType } : {}),
              ...(viewer?.displayName?.trim() ? { guestName: viewer.displayName.trim() } : {}),
              ...(viewer?.email?.trim() ? { guestEmail: viewer.email.trim() } : {}),
            }}
          />
        </div>
      </div>
    </section>
  );
}
