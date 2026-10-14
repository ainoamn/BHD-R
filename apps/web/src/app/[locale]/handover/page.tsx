import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { hasPermission } from '@bhd-r/authz';
import { HandoverDesk } from '@/components/handover-desk';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readClaims } from '@/lib/portal-ops-data';
import { getViewer } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Property handover | تسليم العقار',
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Where the tenant's handover pass leads when scanned: the owner, their representative or the
 * building guard (anyone with `reservation.handover`) confirms the tenant and records the handover.
 */
export default async function HandoverDeskPage({
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
    const self = `/${locale}/handover${token ? `?t=${encodeURIComponent(token)}` : ''}`;
    redirect(`/${locale}/login?next=${encodeURIComponent(self)}`);
  }
  const claims = await readClaims();
  const allowed = Boolean(claims && hasPermission(claims, 'reservation.handover'));

  return (
    <main className="handover-desk-page" dir={ar ? 'rtl' : 'ltr'}>
      <header className="handover-desk-page__head">
        <span className="ops-kicker">BHD R · HANDOVER</span>
        <h1>{ar ? 'تسليم العقار للمستأجر' : 'Hand over the premises'}</h1>
        <p className="muted">
          {ar
            ? 'امسح رمز التسليم الظاهر في حساب المستأجر أو أدخل رمزه؛ يُطلب من المستأجر فوراً التقاط صورة سيلفي بهاتفه لتظهر لك هنا. طابق وجهه، ثم سجّل حالة العقار.'
            : 'Scan the handover code in the tenant’s account or type it; the tenant is asked at once to take a selfie on their phone, which appears here. Match the face, then record the state of the premises.'}
        </p>
      </header>
      {allowed ? (
        <HandoverDesk locale={locale} initialToken={token} />
      ) : (
        <p className="notice notice--error" role="alert">
          {ar
            ? 'لا تملك صلاحية تسليم العقارات. يمنحها المالك أو مدير المؤسسة من صفحة الفريق («تسليم العقار للمستأجر بمسح رمزه»).'
            : 'You do not have permission to hand over premises. The owner or an organization admin grants it on the team page.'}
        </p>
      )}
    </main>
  );
}
