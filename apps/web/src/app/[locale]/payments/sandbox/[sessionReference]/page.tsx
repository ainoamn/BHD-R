import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Card, CardContent } from '@bhd-r/ui';
import { SandboxPaymentForm } from '@/components/sandbox-payment-form';
import { isBookingSandboxAllowed } from '@/lib/runtime-env';

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
  if (!isBookingSandboxAllowed()) notFound();
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
              ? 'هذه الصفحة للاختبار المحلي وبيئة الاختبار فقط، ولا تخصم أي مبلغ حقيقي.'
              : 'This page is available only in local and sandbox environments. It never charges real money.'}
          </p>
          <SandboxPaymentForm
            sessionReference={sessionReference}
            {...(returnPath ? { returnPath } : {})}
          />
        </CardContent>
      </Card>
    </section>
  );
}
