import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === 'ar' ? 'رحلاتي' : 'My trips',
    robots: { index: false, follow: false },
  };
}

/** Phase 5 guest portal shell — separate from long-term tenant portal. */
export default async function GuestStaysPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  if (!isStaysPlatformEnabled()) notFound();
  const ar = locale === 'ar';

  return (
    <main className="section">
      <div className="container">
        <h1>{ar ? 'رحلاتي / إقاماتي' : 'My trips / stays'}</h1>
        <p className="muted">
          {ar
            ? 'بوابة الضيف اليومي منفصلة عن بوابة المستأجر طويل المدة. أنشئ الحجز من صفحة الإعلان العامة؛ التأكيد يصل بعد دفع webhook.'
            : 'Daily-guest portal is separate from long-term tenant. Create a booking on the public listing page; confirmation follows the payment webhook.'}
        </p>
      </div>
    </main>
  );
}
