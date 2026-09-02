import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isPaymentSandboxPilotEnabled } from '@bhd-r/config';
import { formatMoney } from '@/lib/format';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { lookupStaySandboxSessionOnNeon } from '@/lib/public-stays-payment-neon';
import { SandboxPaymentForm } from '@/components/sandbox-payment-form';
import { getViewer } from '@/lib/viewer';

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

  const [session, viewer] = await Promise.all([
    stayKind && hasDatabaseUrl()
      ? lookupStaySandboxSessionOnNeon(sessionReference).catch(() => null)
      : Promise.resolve(null),
    getViewer().catch(() => null),
  ]);

  const defaultCardholderName =
    session?.guestDisplayName?.trim() ||
    viewer?.displayName?.trim() ||
    'ABDUL HAMID AL RAWAHI';

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
                </dl>
                <p className="pay-gateway-shell__summary-place">
                  {ar ? 'جبال صلالة · ظفار' : 'Salalah mountains · Dhofar'}
                </p>
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
          defaultCardholderName={defaultCardholderName}
          {...(returnPath ? { returnPath } : {})}
          {...(session
            ? {
                amountMinor: session.amountMinor,
                currency: session.currency,
                referenceCode: session.referenceCode,
              }
            : {})}
        />
      </div>
    </section>
  );
}
