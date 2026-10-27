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
  const refRaw = query.ref;
  const initialReference =
    typeof refRaw === 'string' && /^[A-Za-z0-9-]{6,40}$/.test(refRaw.trim())
      ? refRaw.trim().toUpperCase()
      : Array.isArray(refRaw) && typeof refRaw[0] === 'string' && /^[A-Za-z0-9-]{6,40}$/.test(refRaw[0].trim())
        ? refRaw[0].trim().toUpperCase()
        : null;

  const viewer = await getViewer();
  if (!viewer) {
    const params = new URLSearchParams();
    if (token) params.set('t', token);
    if (initialReference) params.set('ref', initialReference);
    const q = params.toString();
    const self = `/${locale}/handover${q ? `?${q}` : ''}`;
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
            ? 'امسح رمز التسليم الظاهر في حساب المستأجر أو أدخل رمزه؛ يُطلب في اللحظة نفسها من الطرفين صورة سيلفي: المستأجر من هاتفه، وأنت من جهازك. طابق وجه المستأجر، ثم سجّل حالة العقار.'
            : 'Scan the handover code in the tenant’s account or type it; both of you are asked for a selfie at the same moment: the tenant on their phone, and you on your device. Match the tenant’s face, then record the state of the premises.'}
        </p>
      </header>
      {allowed ? (
        <HandoverDesk
          locale={locale}
          initialToken={token}
          initialReference={initialReference}
        />
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
