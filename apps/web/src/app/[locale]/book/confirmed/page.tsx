import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { LeaseHandoverPanel } from '@/components/lease-handover-panel';
import { LeaseJourneyCard } from '@/components/lease-journey';
import { PropertyLocationMap } from '@/components/property-location-map';
import { StayJourneyProvider, StayJourneySteps } from '@/components/stays/stay-journey';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { formatMoney, localizedName } from '@/lib/format';
import { leaseContractTitle } from '@/lib/lease-booking-contract';
import { leaseConfirmedPath } from '@/lib/lease-booking-paths';
import {
  journeyStamp,
  leaseJourneyInitialStep,
  leaseJourneyReachable,
  leaseJourneySteps,
  type LeaseJourneyProps,
} from '@/lib/lease-journey-screens';
import { leasePhaseLabel, phaseWaitsOn } from '@/lib/lease-reservation-lifecycle';
import { loadLeaseBookingForViewer, leasePaymentPath } from '@/lib/public-lease-booking-neon';
import { partyDisplayName } from '@/lib/reservation-party';
import { getViewer } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your booking | حجزك',
  robots: { index: false, follow: false, nocache: true },
};

export default async function LeaseBookingConfirmedPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const ar = locale === 'ar';
  const query = await searchParams;
  const refRaw = query.ref;
  const ref = typeof refRaw === 'string' ? refRaw : Array.isArray(refRaw) ? refRaw[0] : undefined;
  if (!ref || !hasDatabaseUrl()) notFound();

  const viewer = await getViewer();
  if (!viewer) {
    redirect(`/${locale}/login?next=${encodeURIComponent(leaseConfirmedPath(locale, ref))}`);
  }

  const booking = await loadLeaseBookingForViewer(viewer.id, ref).catch(() => null);
  if (!booking) notFound();
  if (!booking.depositPaidAt && booking.status === 'pending') {
    redirect(leasePaymentPath(locale, booking.sessionReference, booking.referenceCode));
  }

  const paid = Boolean(booking.depositPaidAt);
  const sale = booking.mode === 'sale';
  const deposit = formatMoney(booking.depositMinor, booking.currency, locale);
  const priceMinor = sale ? booking.salePriceMinor : booking.rentMinor;
  const price =
    priceMinor && priceMinor !== '0' ? formatMoney(priceMinor, booking.currency, locale) : null;
  const propertyName = localizedName(locale, booking.propertyNameAr, booking.propertyNameEn);
  const unitName = localizedName(locale, booking.unitNameAr, booking.unitNameEn);
  const contractTitle = leaseContractTitle(booking.mode);
  const forOther = booking.bookingFor === 'other';
  const name =
    (forOther ? booking.bookedByName : booking.contact.fullName) ||
    (ar ? 'العميل الكريم' : 'valued customer');
  const firstName = name.split(/\s+/)[0] ?? name;
  const closed = booking.phase === 'closed';
  const journey: LeaseJourneyProps = {
    locale,
    referenceCode: booking.referenceCode,
    mode: booking.mode,
    phase: booking.phase,
    lifecycle: booking.lifecycle,
    deposit,
    propertyName,
  };
  const steps = closed ? [] : leaseJourneySteps(journey);
  const initialStep = leaseJourneyInitialStep(booking.phase);
  const waitsOn = phaseWaitsOn(booking.phase);
  const contract = booking.lifecycle.contract;
  const otherLocale = ar ? 'en' : 'ar';
  const samePageHref = `/book/confirmed?ref=${encodeURIComponent(booking.referenceCode)}`;

  return (
    <main className="guest-stay-detail lease-journey">
      <StayJourneyProvider key={`${booking.phase}:${initialStep}`} initial={initialStep}>
        <section className="guest-stay-detail__hero" aria-labelledby="lease-journey-title">
          <img
            className="guest-stay-detail__hero-img"
            src="/brand/oman-landmark-mosque.jpg"
            alt={ar ? 'جامع السلطان قابوس الأكبر، مسقط' : 'Sultan Qaboos Grand Mosque, Muscat'}
          />
          <div className="guest-stay-detail__hero-scrim" />
          <div className="guest-stay-detail__hero-top">
            <Link className="guest-stay-detail__back" href={`/units/${booking.unitId}`}>
              {ar ? '→ العقار' : '← Property'}
            </Link>
            <Link
              className="guest-stay-detail__back guest-stay-detail__lang"
              href={samePageHref}
              locale={otherLocale}
              hrefLang={otherLocale}
              lang={otherLocale}
            >
              {ar ? 'English' : 'العربية'}
            </Link>
            <Link
              className="guest-stay-detail__logo logo__product logo__product--on-dark"
              href="/"
              aria-label="BHD R"
            >
              <img src="/brand/bhd-official-symbol.svg" alt="" width="84" height="26" />
              <i>R</i>
            </Link>
          </div>
          <div className="guest-stay-detail__hero-content">
            <p className="guest-stay-detail__kicker">
              {ar ? `أهلاً ${firstName} 👋` : `Hello ${firstName} 👋`}
            </p>
            <h1 id="lease-journey-title" className="guest-stay-detail__title">
              {propertyName}
              {unitName ? ` — ${unitName}` : ''}
            </h1>
            <div className="guest-stay-detail__badges">
              <span
                className={`guest-stay-detail__status guest-stay-detail__status--${
                  closed
                    ? 'negative'
                    : waitsOn === 'customer'
                      ? 'warning'
                      : waitsOn === 'owner'
                        ? 'approval'
                        : 'positive'
                }`}
              >
                {closed
                  ? booking.status === 'cancelled'
                    ? ar
                      ? 'ملغى'
                      : 'Cancelled'
                    : ar
                      ? 'انتهت المهلة'
                      : 'Expired'
                  : leasePhaseLabel(booking.phase, ar, {
                      docsNeedVerify:
                        booking.lifecycle.requirements.some(
                          (item) =>
                            item.autoApproved && item.status === 'approved' && !item.verified,
                        ) ||
                        booking.lifecycle.cheques.some(
                          (item) =>
                            item.autoApproved && item.status === 'approved' && !item.verified,
                        ),
                      viewer: 'tenant',
                    })}
              </span>
              <span className="guest-stay-detail__ref" dir="ltr">
                {booking.referenceCode}
              </span>
            </div>
            {steps.length ? (
              <StayJourneySteps steps={steps} reachable={leaseJourneyReachable(journey)} ar={ar} />
            ) : null}
          </div>
          <p className="guest-stay-detail__caption">
            {ar ? 'جامع السلطان قابوس الأكبر · مسقط' : 'Sultan Qaboos Grand Mosque · Muscat'}
          </p>
        </section>

        <section className="guest-stay-detail__panel">
          <div className="guest-stay-detail__panel-body">
            {closed && booking.lifecycle.cancellation ? (
              <section className="guest-stay-detail__greeting guest-stay-detail__greeting--ended">
                <h2>{ar ? 'أُلغي هذا الحجز' : 'This booking was cancelled'}</h2>
                <p>
                  {booking.lifecycle.cancellation.reason === 'documents_invalid'
                    ? ar
                      ? 'بعد تحقق الفريق تبيّن أن المستندات المرفوعة تخالف الاشتراطات أو غير ملائمة، لذا اعتُبر الحجز ملغياً كما نُبّهت عند الاعتماد الإلكتروني.'
                      : 'After the team verified them, the uploaded documents broke the requirements or were unsuitable, so the booking was cancelled as you were told at the electronic approval.'
                    : ar
                      ? 'لم يتأكد وصول مبلغ العربون، لذا أُلغي الحجز.'
                      : 'The deposit could not be confirmed as received, so the booking was cancelled.'}
                </p>
                {booking.lifecycle.cancellation.note ? (
                  <p>
                    <strong>{ar ? 'السبب: ' : 'Reason: '}</strong>
                    {booking.lifecycle.cancellation.note}
                  </p>
                ) : null}
                <Link
                  className="button button--primary guest-stay-detail__rebook"
                  href={`/book/${booking.unitId}?mode=${booking.mode}`}
                >
                  {ar ? 'ابدأ حجزاً جديداً' : 'Start a new booking'}
                </Link>
              </section>
            ) : closed ? (
              <section className="guest-stay-detail__greeting guest-stay-detail__greeting--ended">
                <h2>
                  {paid
                    ? ar
                      ? 'انتهى هذا الحجز'
                      : 'This booking has ended'
                    : ar
                      ? 'انتهت مهلة الدفع لهذا الحجز'
                      : 'The payment window expired'}
                </h2>
                <p>
                  {ar
                    ? 'يمكنك بدء حجز جديد من صفحة العقار في أي وقت.'
                    : 'You can start a new booking from the property page any time.'}
                </p>
                <Link
                  className="button button--primary guest-stay-detail__rebook"
                  href={`/book/${booking.unitId}?mode=${booking.mode}`}
                >
                  {ar ? 'ابدأ الحجز من جديد' : 'Start a new booking'}
                </Link>
              </section>
            ) : (
              <LeaseJourneyCard {...journey} />
            )}

            {!closed &&
            (booking.phase === 'awaiting_handover' || booking.lifecycle.handover?.scanned) ? (
              <LeaseHandoverPanel
                locale={locale}
                referenceCode={booking.referenceCode}
                handover={booking.lifecycle.handover}
              />
            ) : null}

            <section className="guest-stay-detail__card">
              <h2>{ar ? 'تفاصيل الحجز' : 'Booking details'}</h2>
              <dl className="guest-stay-detail__facts">
                <div>
                  <dt>{ar ? 'نوع الحجز' : 'Booking type'}</dt>
                  <dd>{ar ? contractTitle.ar : contractTitle.en}</dd>
                </div>
                <div>
                  <dt>{ar ? 'رقم الحجز' : 'Reference'}</dt>
                  <dd dir="ltr">{booking.referenceCode}</dd>
                </div>
                {forOther || booking.party ? (
                  <div>
                    <dt>{sale ? (ar ? 'المشتري' : 'Buyer') : ar ? 'المستأجر' : 'Tenant'}</dt>
                    <dd>
                      {booking.party
                        ? partyDisplayName(booking.party, ar)
                        : booking.contact.fullName}
                    </dd>
                  </div>
                ) : null}
                {!sale && booking.party?.termMonths ? (
                  <div>
                    <dt>{ar ? 'مدة العقد المطلوبة' : 'Requested term'}</dt>
                    <dd>
                      {booking.party.termMonths} {ar ? 'شهراً' : 'months'}
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt>
                    {sale
                      ? ar
                        ? 'سعر البيع'
                        : 'Sale price'
                      : ar
                        ? 'الإيجار الشهري'
                        : 'Monthly rent'}
                  </dt>
                  <dd dir="ltr">{price ?? '—'}</dd>
                </div>
                <div>
                  <dt>{ar ? 'العربون المدفوع' : 'Deposit paid'}</dt>
                  <dd dir="ltr">{paid ? deposit : '—'}</dd>
                </div>
                {paid ? (
                  <div>
                    <dt>{ar ? 'تاريخ الدفع' : 'Paid on'}</dt>
                    <dd>{journeyStamp(booking.depositPaidAt, ar)}</dd>
                  </div>
                ) : null}
                {paid && !booking.lifecycle.tenantSignedAt && !closed ? (
                  <div>
                    <dt>{ar ? 'محجوز لك حتى' : 'Reserved for you until'}</dt>
                    <dd>{journeyStamp(booking.reservedUntil, ar)}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>{ar ? 'اتفاقية الحجز' : 'Booking agreement'}</dt>
                  <dd>
                    {booking.esignSignedAt
                      ? ar
                        ? `موقّعة إلكترونياً · ${journeyStamp(booking.esignSignedAt, ar)}`
                        : `E-signed · ${journeyStamp(booking.esignSignedAt, ar)}`
                      : ar
                        ? 'بانتظار توقيعك'
                        : 'Awaiting your signature'}
                  </dd>
                </div>
                {booking.lifecycle.approvedAt ? (
                  <div>
                    <dt>{ar ? 'اعتماد المالك' : 'Owner approval'}</dt>
                    <dd>{journeyStamp(booking.lifecycle.approvedAt, ar)}</dd>
                  </div>
                ) : null}
                {contract ? (
                  <div>
                    <dt>
                      {sale ? (ar ? 'عقد البيع' : 'Sale contract') : ar ? 'عقد الإيجار' : 'Lease'}
                    </dt>
                    <dd>
                      <bdi dir="ltr">{contract.reference}</bdi>
                      {' · '}
                      {booking.lifecycle.cancellation
                        ? ar
                          ? 'ملغى'
                          : 'Voided'
                        : booking.lifecycle.tenantSignedAt
                          ? ar
                            ? 'موقّع من الطرفين'
                            : 'Signed by both parties'
                          : ar
                            ? 'بانتظار توقيعك'
                            : 'Awaiting your signature'}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>

            {booking.location ? (
              <section className="guest-stay-detail__card">
                <h2>{ar ? 'موقع العقار' : 'Property location'}</h2>
                <PropertyLocationMap location={booking.location} locale={locale} />
              </section>
            ) : null}

            <div className="guest-stay-detail__docs">
              {paid ? (
                <Link
                  className="button button--quiet"
                  href={`/book/receipt?ref=${encodeURIComponent(booking.referenceCode)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {ar ? 'إيصال العربون (PDF)' : 'Deposit receipt (PDF)'}
                </Link>
              ) : null}
              {paid ? (
                <Link
                  className="button button--quiet"
                  href={
                    booking.esignSignedAt
                      ? `/book/sign?ref=${encodeURIComponent(booking.referenceCode)}&view=1`
                      : `/book/sign?ref=${encodeURIComponent(booking.referenceCode)}`
                  }
                >
                  {booking.esignSignedAt
                    ? ar
                      ? 'اتفاقية الحجز الموقّعة'
                      : 'Signed booking agreement'
                    : ar
                      ? 'توقيع اتفاقية الحجز'
                      : 'Sign booking agreement'}
                </Link>
              ) : null}
              {contract ? (
                <Link
                  className="button button--quiet"
                  href={`/tenant/contracts/${encodeURIComponent(contract.id)}`}
                >
                  {ar ? 'عرض العقد' : 'View contract'}
                </Link>
              ) : null}
              <Link className="button button--quiet" href="/properties">
                {ar ? 'تصفح عقارات أخرى' : 'Browse other properties'}
              </Link>
            </div>
            <p className="guest-stay-detail__help muted">
              {ar
                ? 'احتفظ برقم حجزك في متناول يدك؛ فهو مفتاحك لمتابعة كل مرحلة من مراحل حجزك.'
                : 'Keep your booking reference handy — it is your key to following every step.'}
            </p>
          </div>
        </section>
      </StayJourneyProvider>
    </main>
  );
}
