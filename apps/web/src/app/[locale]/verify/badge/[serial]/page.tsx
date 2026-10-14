import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { AwardCertificate } from '@/components/badges/award-certificate';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadPublicAward } from '@/lib/badges-neon';
import { privatePortalRobots } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'التحقق من الشارة · Badge verification',
  robots: privatePortalRobots,
};

/** Opened from the QR code on a certificate: confirms the serial is genuine and its status. */
export default async function BadgeVerifyPage({
  params,
}: {
  params: Promise<{ locale: string; serial: string }>;
}) {
  const { locale: rawLocale, serial } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  const ar = locale === 'ar';
  setRequestLocale(locale);
  const award = hasDatabaseUrl()
    ? await loadPublicAward(decodeURIComponent(serial)).catch((error: unknown) => {
        console.error('badge verification failed', error);
        return null;
      })
    : null;
  return (
    <main className="badge-verify" dir={ar ? 'rtl' : 'ltr'}>
      {award ? (
        <>
          <p className={`badge-verify__verdict is-${award.status}`} role="status">
            {award.status === 'active'
              ? ar
                ? '✓ شارة أصلية وسارية صادرة من نظام بن حمود للتميّز'
                : '✓ Genuine and valid — issued by the BHD excellence system'
              : award.status === 'expired'
                ? ar
                  ? 'شارة أصلية لكنها منتهية الصلاحية'
                  : 'Genuine, but expired'
                : ar
                  ? 'شارة أصلية لكنها سُحبت ولم تعد سارية'
                  : 'Genuine, but withdrawn'}
          </p>
          <AwardCertificate data={award} locale={locale} publicView />
        </>
      ) : (
        <section className="badge-verify__missing">
          <h1>{ar ? 'لم نعثر على هذه الشارة' : 'Badge not found'}</h1>
          <p className="muted">
            {ar
              ? 'تأكد من الرقم التسلسلي المطبوع على الشهادة (مثل AWD-2026-000001).'
              : 'Check the serial printed on the certificate (e.g. AWD-2026-000001).'}
          </p>
        </section>
      )}
    </main>
  );
}
