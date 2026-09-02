import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isPaymentSandboxPilotEnabled } from '@bhd-r/config';
import { Card, CardContent } from '@bhd-r/ui';
import { SandboxPaymentForm } from '@/components/sandbox-payment-form';

export const metadata: Metadata = {
  title: 'Sandbox payment | دفع تجريبي',
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
  return (
    <section className="auth-shell payment-sandbox">
      <Card className="auth-card">
        <CardContent>
          <span className="eyebrow">BHD R · SANDBOX</span>
          <h1>
            {stayKind
              ? ar
                ? 'محاكاة دفع الإقامة'
                : 'Stay payment simulator'
              : ar
                ? 'محاكاة بوابة الدفع'
                : 'Payment gateway simulator'}
          </h1>
          <p>
            {ar
              ? 'هذه الصفحة للاختبار والتجربة فقط — لا تُخصم أي مبالغ حقيقية.'
              : 'This page is for testing and pilot flows only. It never charges real money.'}
          </p>
          <SandboxPaymentForm
            sessionReference={sessionReference}
            stayKind={stayKind}
            {...(returnPath ? { returnPath } : {})}
          />
        </CardContent>
      </Card>
    </section>
  );
}
