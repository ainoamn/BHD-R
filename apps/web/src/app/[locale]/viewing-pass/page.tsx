import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { ViewingPassCard } from '@/components/viewing-pass-card';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { contractQrSvg } from '@/lib/contract-verify';
import { loadViewingGuestPass } from '@/lib/viewing-requests-neon';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Viewing pass | بطاقة المعاينة',
  robots: { index: false, follow: false, nocache: true },
};

/** Guest viewing pass: barcode, username and PIN (token in the query; no login required). */
export default async function ViewingPassPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  if (!hasDatabaseUrl()) notFound();
  const ar = locale === 'ar';
  const query = await searchParams;
  const tokenRaw = query.t;
  const token =
    typeof tokenRaw === 'string' && /^[A-Za-z0-9_-]{40,120}$/.test(tokenRaw) ? tokenRaw : null;
  if (!token) notFound();

  const pass = await loadViewingGuestPass(token).catch(() => null);
  if (!pass) notFound();
  const qrSvg = !pass.arrivedAt ? await contractQrSvg(pass.token).catch(() => null) : null;

  return (
    <main className="viewing-pass-page" dir={ar ? 'rtl' : 'ltr'}>
      <ViewingPassCard locale={locale} token={token} initialPass={{ ...pass, qrSvg }} />
    </main>
  );
}
