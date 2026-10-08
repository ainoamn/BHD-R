import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { StayCheckout } from '@/components/stays/stay-checkout';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadBookingContacts, type BookingContactsForViewer } from '@/lib/booking-contacts-neon';
import { loadBookingTermsForUnit } from '@/lib/booking-terms-neon';
import { localizedName } from '@/lib/format';
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

  return (
    <section
      className="stays-book-shell stays-book-shell--wide-form"
      data-stay-book-immersive="true"
    >
      <aside className="stays-book-shell__aside">
        <div className="stays-book-shell__aside-inner">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="stays-book-shell__aside-bg" src={cover} alt="" />
          ) : (
            <div className="stays-book-shell__aside-bg stays-book-shell__aside-bg--fallback" />
          )}
          <div className="stays-book-shell__aside-scrim" />
          <div className="stays-book-shell__aside-content">
            <div className="stays-book-shell__topbar">
              <Link
                className="stays-book-shell__back"
                href={`/stays/${encodeURIComponent(slug)}${unitId ? `?unit=${encodeURIComponent(unitId)}` : ''}`}
              >
                {ar ? '← العودة للإقامة' : '← Back to stay'}
              </Link>
              <Link
                className="stays-book-shell__lang"
                href={`/stays/${encodeURIComponent(slug)}/book${switchQs ? `?${switchQs}` : ''}`}
                locale={otherLocale}
                hrefLang={otherLocale}
                lang={otherLocale}
                aria-label={ar ? 'Switch to English' : 'التبديل إلى العربية'}
              >
                <span aria-hidden="true">🌐</span>
                {ar ? 'English' : 'العربية'}
              </Link>
            </div>
            <div className="stays-book-shell__intro">
              <span
                className="stays-book-shell__brand logo__product logo__product--on-dark"
                aria-label="BHD R"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/bhd-official-symbol.svg" alt="" width="156" height="52" />
                <i>R</i>
              </span>
              <p className="stays-book-shell__headline">
                {ar ? (
                  <>
                    احجز إقامتك القادمة
                    <span>بدفع آمن عبر BHD R</span>
                  </>
                ) : (
                  <>
                    Book your next stay
                    <span>with secure payment through BHD R</span>
                  </>
                )}
              </p>
              <p className="stays-book-shell__place">{title}</p>
              <p className="stays-book-shell__lede">
                {ar
                  ? 'أصبح حجز إقامتك أسهل من أي وقت مضى، في أربع خطوات بسيطة:'
                  : 'Booking your stay has never been easier — four simple steps:'}
              </p>
              <ol className="stays-book-shell__steps">
                {(ar
                  ? [
                      'اختيار تواريخ الإقامة ونوعها.',
                      'إدخال بياناتك.',
                      'مراجعة الحجز والموافقة على الشروط والأحكام.',
                      'الدفع بأمان وتوقيع العقد إلكترونيًا.',
                    ]
                  : [
                      'Choose your dates and stay type.',
                      'Enter your details.',
                      'Review the booking and accept the terms and conditions.',
                      'Pay securely and sign the contract online.',
                    ]
                ).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="stays-book-shell__cta">
                {ar ? 'ابدأ إجراءات الحجز الآن' : 'Start your booking now'}
                <span
                  className="stays-book-shell__cta-arrow stays-book-shell__cta-arrow--down"
                  aria-hidden="true"
                >
                  ↓
                </span>
                <span
                  className="stays-book-shell__cta-arrow stays-book-shell__cta-arrow--side"
                  aria-hidden="true"
                >
                  {ar ? '←' : '→'}
                </span>
              </p>
            </div>
          </div>
        </div>
      </aside>

      <div className="stays-book-shell__panel">
        <StayCheckout
          locale={locale}
          slug={slug}
          title={title}
          {...(bookingUnitId ? { unitId: bookingUnitId } : {})}
          terms={dailyTerms}
          contacts={contacts}
          defaults={{
            ...(pickQuery(query, 'checkInOn') ? { checkInOn: pickQuery(query, 'checkInOn')! } : {}),
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
    </section>
  );
}
