import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { SecurityUnlockForm } from '@/components/security-unlock-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'فتح الحساب المقفول | Security unlock',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default async function SecurityUnlockPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  return <SecurityUnlockForm />;
}
