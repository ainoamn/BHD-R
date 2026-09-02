import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isPaymentSandboxPilotEnabled } from '@bhd-r/config';
import { formatMoney } from '@/lib/format';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
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

  const session =
    stayKind && hasDatabaseUrl()
      ? await lookupStaySandboxSessionOnNeon(sessionReference).catch(() => null)
      : null;

  return (
    <section className="pay-gateway-shell">
      <div className="pay-gateway-shell__panel">
        <header className="pay-gateway-shell__header">
          <div>
            <p className="pay-gateway-shell__brand">BHD Pay</p>
            <h1>{ar ? 'إتمام الدفع' : 'Complete payment'}</h1>
          </div>
          <span className="pay-gateway-shell__badge">
            {ar ? 'تجريبي' : 'Pilot'}
          </span>
        </header>

        {session ? (
          <div className="pay-gateway-shell__summary">
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
          </div>
        ) : (
          <p className="muted pay-gateway-shell__hint">
            {ar
              ? 'أدخل بيانات بطاقتك للمتابعة. لن يُخصم مبلغ حقيقي في هذا الوضع.'
              : 'Enter your card details to continue. No real charge is made in this mode.'}
          </p>
        )}

        <SandboxPaymentForm
          sessionReference={sessionReference}
          stayKind={stayKind}
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
