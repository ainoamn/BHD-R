import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { hasPermission } from '@bhd-r/authz';
import { ViewingGateDesk } from '@/components/viewing-gate-desk';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readClaims } from '@/lib/portal-ops-data';
import { getViewer } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Viewing check-in | تسجيل وصول المعاينة',
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Where the guest viewing barcode leads when scanned: the building guard (or staff with
 * viewing.checkin) confirms the visitor and records arrival time.
 */
export default async function ViewingGatePage({
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
    const self = `/${locale}/viewing-gate${token ? `?t=${encodeURIComponent(token)}` : ''}`;
    redirect(`/${locale}/login?next=${encodeURIComponent(self)}`);
  }
  const claims = await readClaims();
  const allowed = Boolean(claims && hasPermission(claims, 'viewing.checkin'));

  return (
    <main className="viewing-gate-page" dir={ar ? 'rtl' : 'ltr'}>
      <header className="viewing-gate-page__head">
        <span className="ops-kicker">BHD R · VIEWING GATE</span>
        <h1>{ar ? 'تسجيل وصول زائر المعاينة' : 'Viewing visitor check-in'}</h1>
        <p className="muted">
          {ar
            ? 'امسح باركود بطاقة المعاينة أو أدخل اسم المستخدم والرقم السري؛ يظهر لك علامة صح ويُوثَّق وقت الوصول.'
            : 'Scan the viewing pass barcode or type the username and PIN; a checkmark appears and the arrival time is recorded.'}
        </p>
      </header>
      {allowed ? (
        <ViewingGateDesk locale={locale} initialToken={token} />
      ) : (
        <p className="notice notice--error" role="alert">
          {ar
            ? 'لا تملك صلاحية تسجيل وصول المعاينات. يمنحها المالك من صفحة الفريق («مسح بطاقة المعاينة عند وصول الزائر»).'
            : 'You do not have permission to check in viewing visitors. The owner grants it on the team page.'}
        </p>
      )}
    </main>
  );
}
