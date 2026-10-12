import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { ContractVerifyView } from '@/components/contract-verify-view';
import { loadContractVerification } from '@/lib/contract-verify-neon';
import { privatePortalRobots } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'التحقق من العقد · Contract verification',
  robots: privatePortalRobots,
};

/** Opened from the QR code printed on a contract. */
export default async function ContractVerifyPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale: rawLocale, token } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const result = await loadContractVerification(token).catch((error: unknown) => {
    console.error('contract verification failed', error);
    return null;
  });
  return <ContractVerifyView result={result} locale={locale} />;
}
