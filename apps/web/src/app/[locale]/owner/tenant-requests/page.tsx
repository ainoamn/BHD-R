import { OwnerTenantRequests } from '@/components/owner-tenant-requests';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { readClaims } from '@/lib/portal-ops-data';
import { canHandleTenantRequests, listOwnerTenantRequests } from '@/lib/tenant-requests-neon';
import { requirePortal } from '@/lib/viewer';

async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ focus?: string | string[] }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  const ar = locale === 'ar';
  await requirePortal(locale, 'owner');
  const claims = await readClaims();
  const allowed = Boolean(claims && hasDatabaseUrl() && canHandleTenantRequests(claims));
  let failed = false;
  const requests =
    allowed && claims
      ? await listOwnerTenantRequests(claims).catch((error: unknown) => {
          console.error('owner tenant requests failed', error);
          failed = true;
          return [];
        })
      : [];
  const focusParam = (await searchParams).focus;
  const focus =
    typeof focusParam === 'string' && /^[0-9a-f-]{36}$/i.test(focusParam) ? focusParam : null;

  return (
    <div className="dash-shell tenant-space">
      <header className="portal-topbar">
        <div>
          <h1>{ar ? 'طلبات المستأجرين' : 'Tenant requests'}</h1>
          <p>
            {ar
              ? 'كل ما يطلبه المستأجرون من حساباتهم: صيانة، تأجيل شيك أو إيقافه، إلغاء العقد أو تجديده أو تعديله وغيرها. الموافقة على تأجيل شيك تنقله إلى التاريخ الجديد، والموافقة على إيقافه تلغيه، ويصل ردك للمستأجر بالبريد.'
              : 'Everything tenants ask from their accounts: maintenance, postponing or stopping a cheque, cancelling, renewing or amending the lease. Approving a postponement moves the cheque, approving a stop cancels it, and the tenant is emailed your answer.'}
          </p>
        </div>
      </header>
      {!allowed ? (
        <p className="tenant-notice" role="status">
          {ar
            ? 'ليست لديك صلاحية الرد على طلبات المستأجرين في هذه المنشأة.'
            : 'You may not answer tenant requests in this organization.'}
        </p>
      ) : failed ? (
        <p className="tenant-notice" role="status">
          {ar
            ? 'تعذّر تحميل الطلبات الآن، أعد المحاولة بعد لحظات.'
            : 'Requests could not load; try again shortly.'}
        </p>
      ) : (
        <OwnerTenantRequests requests={requests} locale={locale} focus={focus} />
      )}
    </div>
  );
}

export default persistentPortalPage('/owner/tenant-requests', Page);
