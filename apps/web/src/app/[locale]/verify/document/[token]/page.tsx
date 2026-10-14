import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { RentDocumentVerifyView } from '@/components/rent-document-verify-view';
import { loadRentDocumentVerification } from '@/lib/rent-documents-neon';
import { privatePortalRobots } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'التحقق من إيصال أو فاتورة · Receipt verification',
  robots: privatePortalRobots,
};

/** Opened from the QR code printed on a rent receipt or demand invoice. */
export default async function RentDocumentVerifyPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale: rawLocale, token } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const result = await loadRentDocumentVerification(token).catch((error: unknown) => {
    console.error('rent document verification failed', error);
    return null;
  });
  return <RentDocumentVerifyView result={result} locale={locale} />;
}
