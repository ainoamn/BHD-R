import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { isPaymentSandboxPilotEnabled } from '@bhd-r/config';
import { formatMoney, localizedName } from '@/lib/format';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { leaseSignPath } from '@/lib/lease-booking-paths';
import { lookupLeasePaymentSession } from '@/lib/public-lease-booking-neon';
import { lookupStaySandboxSessionOnNeon } from '@/lib/public-stays-payment-neon';
import { SandboxPaymentForm } from '@/components/sandbox-payment-form';

export const metadata: Metadata = {
  title: 'Secure payment | دفع آمن',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default async function SandboxPaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; sessionReference: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Must match payment-session creation (stays pilot uses STAYS_PLATFORM_ENABLED /
  // PAYMENT_SANDBOX_ENABLED — not the legacy lease ALLOW_BOOKING_SANDBOX gate alone).
  if (!isPaymentSandboxPilotEnabled()) notFound();
  const { locale, sessionReference } = await params;
  if (!/^[A-Za-z0-9_-]{24,80}$/.test(sessionReference)) notFound();
  const query = await searchParams;
  const returnRaw = query.return;
  const returnPath =
    typeof returnRaw === 'string' && returnRaw.startsWith(`/${locale}/`)
      ? returnRaw
      : undefined;
  const ar = locale === 'ar';
  const stayKind = query.kind === 'stay';
  const leaseKind = query.kind === 'lease';

  const session =
    stayKind && hasDatabaseUrl()
      ? await lookupStaySandboxSessionOnNeon(sessionReference).catch(() => null)
      : null;
  const leaseSession =
    leaseKind && hasDatabaseUrl()
      ? await lookupLeasePaymentSession(sessionReference).catch(() => null)
      : null;
  if (leaseKind && leaseSession?.paid) {
    redirect(leaseSignPath(locale, leaseSession.referenceCode));
  }

  const nights = session
    ? Math.max(
        0,
        Math.round(
          (Date.parse(`${session.checkOutOn}T00:00:00.000Z`) -
            Date.parse(`${session.checkInOn}T00:00:00.000Z`)) /
            86_400_000,
        ),
      )
    : 0;

  return (
    <section className="pay-gateway-shell" data-pay-immersive="true">
      <aside className="pay-gateway-shell__aside">
        <div className="pay-gateway-shell__aside-inner">
          <div className="pay-gateway-shell__brand-row">
            <p className="pay-gateway-shell__brand">BHD Pay</p>
            <span className="pay-gateway-shell__badge">{ar ? 'تجريبي' : 'Pilot'}</span>
          </div>
          <h1>{ar ? 'إتمام الدفع' : 'Complete payment'}</h1>
          <p className="pay-gateway-shell__lede">
            {ar
              ? 'أدخل بيانات البطاقة لإكمال الحجز بأمان.'
              : 'Enter your card details to complete the booking securely.'}
          </p>

          {session ? (
            <div className="pay-gateway-shell__summary">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="pay-gateway-shell__summary-bg"
                src="/brand/oman-landmark-salalah.jpg"
                alt=""
              />
              <div className="pay-gateway-shell__summary-scrim" />
              <div className="pay-gateway-shell__summary-body">
                <div>
                  <p className="muted">{ar ? 'المبلغ المستحق' : 'Amount due'}</p>
                  <p className="pay-gateway-shell__amount" dir="ltr">
                    {formatMoney(session.amountMinor, session.currency, locale)}
                  </p>
                </div>
                <dl>
                  <div>
                    <dt>{ar ? 'المرجع' : 'Reference'}</dt>
                    <dd dir="ltr">{session.referenceCode}</dd>
                  </div>
                  <div>
                    <dt>{ar ? 'الوصول' : 'Check-in'}</dt>
                    <dd dir="ltr">{session.checkInOn}</dd>
                  </div>
                  <div>
                    <dt>{ar ? 'المغادرة' : 'Check-out'}</dt>
                    <dd dir="ltr">{session.checkOutOn}</dd>
                  </div>
                  <div>
                    <dt>{ar ? 'عدد الأيام' : 'Nights'}</dt>
                    <dd>
                      {nights}{' '}
                      {ar
                        ? nights === 1
                          ? 'ليلة'
                          : 'ليالٍ'
                        : nights === 1
                          ? 'night'
                          : 'nights'}
                    </dd>
                  </div>
                </dl>
                <p className="pay-gateway-shell__summary-place">
                  {ar ? 'جبال صلالة · ظفار' : 'Salalah mountains · Dhofar'}
                </p>
              </div>
            </div>
          ) : leaseSession ? (
            <div className="pay-gateway-shell__summary">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="pay-gateway-shell__summary-bg"
                src="/brand/oman-landmark-salalah.jpg"
                alt=""
              />
              <div className="pay-gateway-shell__summary-scrim" />
              <div className="pay-gateway-shell__summary-body">
                <div>
                  <p className="muted">{ar ? 'مبلغ الضمان المستحق' : 'Deposit due'}</p>
                  <p className="pay-gateway-shell__amount" dir="ltr">
                    {formatMoney(leaseSession.amountMinor, leaseSession.currency, locale)}
                  </p>
                </div>
                <dl>
                  <div>
                    <dt>{ar ? 'المرجع' : 'Reference'}</dt>
                    <dd dir="ltr">{leaseSession.referenceCode}</dd>
                  </div>
                  <div>
                    <dt>{ar ? 'نوع الحجز' : 'Booking type'}</dt>
                    <dd>
                      {leaseSession.mode === 'sale'
                        ? ar
                          ? 'حجز للشراء'
                          : 'Reserve to buy'
                        : ar
                          ? 'حجز للإيجار'
                          : 'Reserve to rent'}
                    </dd>
                  </div>
                  <div>
                    <dt>{ar ? 'العقار' : 'Property'}</dt>
                    <dd>
                      {localizedName(locale, leaseSession.propertyNameAr, leaseSession.propertyNameEn)}
                    </dd>
                  </div>
                  <div>
                    <dt>{ar ? 'الوحدة' : 'Unit'}</dt>
                    <dd>{localizedName(locale, leaseSession.unitNameAr, leaseSession.unitNameEn)}</dd>
                  </div>
                </dl>
              </div>
            </div>
          ) : (
            <p className="pay-gateway-shell__hint">
              {ar
                ? 'لن يُخصم مبلغ حقيقي في هذا الوضع التجريبي.'
                : 'No real charge is made in this pilot mode.'}
            </p>
          )}

          <ul className="pay-gateway-shell__trust">
            <li>{ar ? 'تشفير اتصال آمن' : 'Encrypted secure connection'}</li>
            <li>{ar ? 'بيانات البطاقة لا تُخزَّن' : 'Card details are not stored'}</li>
            <li>{ar ? 'مدعوم من BHD R' : 'Powered by BHD R'}</li>
          </ul>
        </div>
      </aside>

      <div className="pay-gateway-shell__panel">
        <header className="pay-gateway-shell__header pay-gateway-shell__header--mobile">
          <div>
            <p className="pay-gateway-shell__brand">BHD Pay</p>
            <h2>{ar ? 'بيانات البطاقة' : 'Card details'}</h2>
          </div>
          <span className="pay-gateway-shell__badge">{ar ? 'تجريبي' : 'Pilot'}</span>
        </header>
        <header className="pay-gateway-shell__header pay-gateway-shell__header--desktop">
          <h2>{ar ? 'بيانات البطاقة' : 'Card details'}</h2>
        </header>

        <SandboxPaymentForm
          sessionReference={sessionReference}
          stayKind={stayKind}
          leaseKind={leaseKind}
          {...(returnPath ? { returnPath } : {})}
          {...(leaseSession
            ? {
                amountMinor: leaseSession.amountMinor,
                currency: leaseSession.currency,
                referenceCode: leaseSession.referenceCode,
                rebookHref: `/${locale}/book/${leaseSession.unitId}?mode=${leaseSession.mode}`,
              }
            : {})}
          {...(session
            ? {
                amountMinor: session.amountMinor,
                currency: session.currency,
                referenceCode: session.referenceCode,
                ...(session.listingSlug
                  ? {
                      rebookHref: (() => {
                        const qs = new URLSearchParams();
                        if (session.unitId) qs.set('unit', session.unitId);
                        if (session.stayType) qs.set('stayType', session.stayType);
                        const q = qs.toString();
                        return `/${locale}/stays/${encodeURIComponent(session.listingSlug)}/book${q ? `?${q}` : ''}`;
                      })(),
                    }
                  : {}),
              }
            : {})}
        />
      </div>
    </section>
  );
}
