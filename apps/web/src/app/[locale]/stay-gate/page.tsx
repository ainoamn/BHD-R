import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { hasPermission } from '@bhd-r/authz';
import { StayGateDesk } from '@/components/stays/stay-gate-desk';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readClaims } from '@/lib/portal-ops-data';
import { getViewer } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Stay check-in | تسجيل وصول الإقامة',
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Where the guest stay barcode leads when scanned: staff with stay.booking.manage
 * confirm arrival and record check-in.
 */
export default async function StayGatePage({
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

  const viewer = await getViewer();
  if (!viewer) {
    const self = `/${locale}/stay-gate${token ? `?t=${encodeURIComponent(token)}` : ''}`;
    redirect(`/${locale}/login?next=${encodeURIComponent(self)}`);
  }
  const claims = await readClaims();
  const allowed = Boolean(claims && hasPermission(claims, 'stay.booking.manage'));

  return (
    <main className="viewing-gate-page" dir={ar ? 'rtl' : 'ltr'}>
      <header className="viewing-gate-page__head">
        <span className="ops-kicker">BHD R · STAY GATE</span>
        <h1>{ar ? 'تسجيل وصول ضيف الإقامة' : 'Stay guest check-in'}</h1>
        <p className="muted">
          {ar
            ? 'للحارس أو مسؤول العقار: امسح باركود الضيف من هذه الصفحة بعد تسجيل الدخول، راجع البيانات، ثم أكّد الوصول. مسح الكاميرا وحدها لا يسجّل الدخول.'
            : 'Guards and property managers: scan the guest barcode from this page after signing in, review details, then confirm. Scanning with the phone camera alone does not record check-in.'}
        </p>
      </header>
      {allowed ? (
        <StayGateDesk locale={locale} initialToken={token} />
      ) : (
        <p className="notice notice--error" role="alert">
          {ar
            ? 'لا تملك صلاحية تسجيل وصول الإقامات. يحتاج المالك منح صلاحية إدارة حجوزات الإقامة اليومية.'
            : 'You do not have permission to check in stay guests. The owner must grant daily stay booking management.'}
        </p>
      )}
    </main>
  );
}
