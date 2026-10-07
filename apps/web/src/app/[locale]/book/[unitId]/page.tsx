import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { isPaymentSandboxPilotEnabled } from '@bhd-r/config';
import { Link } from '@/i18n/navigation';
import { LeaseDepositCheckout } from '@/components/lease-deposit-checkout';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadBookingTermsForUnit } from '@/lib/booking-terms-neon';
import { localizedName } from '@/lib/format';
import { loadPublicPropertyShowcaseFromNeon } from '@/lib/load-public-property-neon';
import { loadPublicUnitFromNeon } from '@/lib/load-public-unit-neon';
import { toPublicMediaSrc } from '@/lib/public-media-url';
import { getViewer } from '@/lib/viewer';
import { withTimedResult } from '@/lib/with-timeout';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Mode = 'rent' | 'sale';

export const metadata: Metadata = {
  title: 'Book | حجز',
  robots: { index: false, follow: false },
};

function allowedModesFor(listingPurpose: string): Mode[] {
  if (listingPurpose === 'both') return ['rent', 'sale'];
  return listingPurpose === 'sale' ? ['sale'] : ['rent'];
}

export default async function BookUnitPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; unitId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: rawLocale, unitId } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const ar = locale === 'ar';
  const query = await searchParams;
  const requestedMode: Mode | null =
    query.mode === 'sale' ? 'sale' : query.mode === 'rent' ? 'rent' : null;

  const viewer = await getViewer();
  if (!viewer) {
    const next = `/${locale}/book/${unitId}${requestedMode ? `?mode=${requestedMode}` : ''}`;
    redirect(`/${locale}/login?next=${encodeURIComponent(next)}`);
  }
  if (!hasDatabaseUrl()) redirect(`/${locale}/units/${unitId}`);

  const unitResult = await withTimedResult(loadPublicUnitFromNeon(unitId), 8_000, 'book-unit');
  if (unitResult.status === 'ok' && !unitResult.value) notFound();
  const unit = unitResult.status === 'ok' ? unitResult.value : null;

  const allowedModes = unit ? allowedModesFor(unit.listingPurpose) : (['rent'] as Mode[]);
  const mode: Mode =
    requestedMode && allowedModes.includes(requestedMode) ? requestedMode : allowedModes[0]!;

  let cover: string | null = null;
  if (unit) {
    cover = toPublicMediaSrc(unit.images[0]?.url) ?? unit.images[0]?.url ?? null;
    if (!cover) {
      const showcase = await withTimedResult(
        loadPublicPropertyShowcaseFromNeon(unit.propertyId),
        3_000,
        'book-cover',
      );
      const first = showcase.status === 'ok' ? showcase.value?.gallery?.[0]?.url : undefined;
      cover = toPublicMediaSrc(first) ?? first ?? null;
    }
  }

  const title = unit
    ? `${localizedName(locale, unit.propertyNameAr, unit.propertyNameEn)} — ${localizedName(locale, unit.unitNameAr, unit.unitNameEn)}`
    : '';
  const depositMinor = unit?.deposit?.amountMinor ?? null;
  const hasDeposit = Boolean(depositMinor && depositMinor !== '0');
  const paymentEnabled = isPaymentSandboxPilotEnabled();

  const termsResult =
    unit && hasDeposit && paymentEnabled
      ? await withTimedResult(loadBookingTermsForUnit(unitId, allowedModes), 5_000, 'book-terms')
      : null;
  const termsByMode = termsResult?.status === 'ok' ? termsResult.value : {};

  return (
    <section className="stays-book-shell" data-stay-book-immersive="true">
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
            <Link className="stays-book-shell__back" href={`/units/${unitId}`}>
              {ar ? '← العودة للعقار' : '← Back to property'}
            </Link>
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
                    {mode === 'sale' ? 'احجز عقارك القادم' : 'احجز بيتك القادم'}
                    <span>بعربون آمن من BHD R</span>
                  </>
                ) : (
                  <>
                    {mode === 'sale' ? 'Reserve your next property' : 'Reserve your next home'}
                    <span>with a secure deposit from BHD R</span>
                  </>
                )}
              </p>
              {title ? <p className="stays-book-shell__place">{title}</p> : null}
              <p className="stays-book-shell__lede">
                {ar
                  ? 'وافق على الشروط، ادفع مبلغ الضمان، ثم وقّع العقد وأرفق مستنداتك إلكترونياً.'
                  : 'Accept the terms, pay the deposit, then sign the contract and attach your documents online.'}
              </p>
            </div>
          </div>
        </div>
      </aside>

      <div className="stays-book-shell__panel">
        {!unit ? (
          <section className="stays-checkout stays-checkout--wizard stays-checkout--page">
            <h2>{ar ? 'تعذّر تحميل العقار مؤقتاً' : 'Property temporarily unavailable'}</h2>
            <p className="notice" role="status">
              {ar
                ? 'استغرق الاتصال بقاعدة البيانات وقتاً أطول من المعتاد — أعد المحاولة خلال لحظات.'
                : 'The database took longer than usual — please retry in a moment.'}
            </p>
            <a className="button button--primary" href={`/${locale}/book/${unitId}?mode=${mode}`}>
              {ar ? 'إعادة المحاولة' : 'Retry'}
            </a>
          </section>
        ) : !hasDeposit || !paymentEnabled ? (
          <section className="stays-checkout stays-checkout--wizard stays-checkout--page">
            <h2>{ar ? 'الحجز الإلكتروني غير متاح بعد' : 'Online booking is not available yet'}</h2>
            <p className="stays-checkout__property muted">{title}</p>
            <p className="notice" role="status">
              {!hasDeposit
                ? ar
                  ? 'لم يحدد مالك العقار مبلغ الضمان (العربون) لهذه الوحدة بعد. يمكنك طلب معاينة وسيتواصل معك المالك.'
                  : 'The owner has not set a booking deposit for this unit yet. You can request a viewing and the owner will contact you.'
                : ar
                  ? 'دفع مبلغ الضمان إلكترونياً غير مفعّل حالياً. يمكنك طلب معاينة وسيتواصل معك المالك.'
                  : 'Online deposit payment is not enabled right now. You can request a viewing and the owner will contact you.'}
            </p>
            <Link className="button button--primary" href={`/units/${unitId}`}>
              {ar ? 'العودة وطلب معاينة' : 'Back to request a viewing'}
            </Link>
          </section>
        ) : (
          <LeaseDepositCheckout
            locale={locale}
            unitId={unitId}
            title={title}
            initialMode={mode}
            allowedModes={allowedModes}
            depositMinor={depositMinor!}
            currency={unit.deposit?.currency ?? unit.rent.currency}
            rentMinor={unit.rent.amountMinor}
            salePriceMinor={unit.salePrice?.amountMinor ?? null}
            termsByMode={termsByMode}
            defaults={{
              ...(viewer?.displayName?.trim() ? { fullName: viewer.displayName.trim() } : {}),
              ...(viewer?.email?.trim() ? { email: viewer.email.trim() } : {}),
            }}
          />
        )}
      </div>
    </section>
  );
}
