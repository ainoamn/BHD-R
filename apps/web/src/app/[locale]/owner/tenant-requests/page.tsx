import { Link } from '@/i18n/navigation';
import { OwnerRentCollection } from '@/components/owner-rent-collection';
import { OwnerTenantCharges } from '@/components/owner-tenant-charges';
import { OwnerTenantPolicy } from '@/components/owner-tenant-policy';
import { OwnerTenantRequests } from '@/components/owner-tenant-requests';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { readClaims } from '@/lib/portal-ops-data';
import { canViewRentCollection, loadRentCollection } from '@/lib/rent-collection-neon';
import {
  canChargeTenants,
  canRecordTenantPayments,
  listTenantCharges,
} from '@/lib/tenant-charges-neon';
import { loadTenantPolicyForOwner, tenantPolicyAccess } from '@/lib/tenant-policy-neon';
import { canHandleTenantRequests, listOwnerTenantRequests } from '@/lib/tenant-requests-neon';
import { requirePortal } from '@/lib/viewer';

type Tab = 'requests' | 'rent' | 'charges' | 'settings';

async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    focus?: string | string[];
    tab?: string | string[];
    lease?: string | string[];
  }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  const ar = locale === 'ar';
  await requirePortal(locale, 'owner');
  const claims = await readClaims();
  const live = Boolean(claims && hasDatabaseUrl());
  const allowed = Boolean(live && claims && canHandleTenantRequests(claims));
  const charging = Boolean(
    live && claims && (canChargeTenants(claims) || canRecordTenantPayments(claims)),
  );
  const settings = Boolean(live && claims && tenantPolicyAccess(claims));
  const collecting = Boolean(live && claims && canViewRentCollection(claims));
  const query = await searchParams;
  const asked = typeof query.tab === 'string' ? query.tab : 'requests';
  const tab: Tab =
    asked === 'rent' && collecting
      ? 'rent'
      : asked === 'charges' && charging
        ? 'charges'
        : asked === 'settings' && settings
          ? 'settings'
          : 'requests';
  const leaseParam =
    typeof query.lease === 'string' && /^[0-9a-f-]{36}$/i.test(query.lease) ? query.lease : null;
  const focus =
    typeof query.focus === 'string' && /^[0-9a-f-]{36}$/i.test(query.focus) ? query.focus : null;

  let failed = false;
  const onFail = (label: string) => (error: unknown) => {
    console.error(label, error);
    failed = true;
    return null;
  };
  const requests =
    tab === 'requests' && allowed && claims
      ? ((await listOwnerTenantRequests(claims).catch(onFail('owner tenant requests failed'))) ??
        [])
      : [];
  const rent =
    tab === 'rent' && claims
      ? await loadRentCollection(claims, leaseParam).catch(onFail('owner rent collection failed'))
      : null;
  const charges =
    tab === 'charges' && claims
      ? await listTenantCharges(claims).catch(onFail('owner tenant charges failed'))
      : null;
  const policy =
    tab === 'settings' && claims
      ? await loadTenantPolicyForOwner(claims).catch(onFail('owner tenant policy failed'))
      : null;

  const tabs: Array<{ key: Tab; ar: string; en: string; shown: boolean }> = [
    { key: 'requests', ar: 'الطلبات والبلاغات', en: 'Requests & reports', shown: true },
    { key: 'rent', ar: 'تحصيل الإيجار والإيصالات', en: 'Rent & receipts', shown: collecting },
    { key: 'charges', ar: 'المطالبات المالية', en: 'Charges', shown: charging },
    { key: 'settings', ar: 'الإعدادات', en: 'Settings', shown: settings },
  ];

  return (
    <div className="dash-shell tenant-space">
      <header className="portal-topbar">
        <div>
          <h1>{ar ? 'طلبات وبلاغات المستأجرين' : 'Tenant requests and reports'}</h1>
          <p>
            {ar
              ? 'كل ما يرسله المستأجرون من حساباتهم: صيانة (بصور ووصف، ومستعجلة لسلامة المبنى والقاطنين)، تأجيل شيك أو إيقافه، إلغاء العقد أو تجديده أو تعديله، وبلاغات عن العقار أو العاملين. ويصل كل منها للمسؤولين بحسب صلاحياتهم، ويصل ردك للمستأجر بالبريد.'
              : 'Everything tenants send from their accounts: maintenance (with photos, and urgent for the building’s and occupants’ safety), cheque postponement or stop, lease cancellation, renewal or amendment, and reports about the property or staff. Each reaches the people in charge by their permissions, and the tenant is emailed your answer.'}
          </p>
        </div>
      </header>
      {tabs.filter((item) => item.shown).length > 1 ? (
        <nav className="tenant-requests__tabs" aria-label={ar ? 'الأقسام' : 'Sections'}>
          {tabs
            .filter((item) => item.shown)
            .map((item) => (
              <Link
                key={item.key}
                href={
                  item.key === 'requests'
                    ? '/owner/tenant-requests'
                    : `/owner/tenant-requests?tab=${item.key}`
                }
                className={`button button--tiny ${tab === item.key ? 'button--primary' : 'button--quiet'}`}
                aria-current={tab === item.key ? 'page' : undefined}
              >
                {ar ? item.ar : item.en}
              </Link>
            ))}
        </nav>
      ) : null}
      {failed ? (
        <p className="tenant-notice" role="status">
          {ar
            ? 'تعذّر التحميل الآن، أعد المحاولة بعد لحظات.'
            : 'Could not load; try again shortly.'}
        </p>
      ) : tab === 'rent' && rent && claims ? (
        <OwnerRentCollection
          locale={locale}
          view={rent}
          canRecord={canRecordTenantPayments(claims)}
        />
      ) : tab === 'charges' && charges && claims ? (
        <OwnerTenantCharges
          locale={locale}
          charges={charges.charges}
          leases={charges.leases}
          canCreate={canChargeTenants(claims)}
          canRecordPayments={canRecordTenantPayments(claims)}
        />
      ) : tab === 'settings' && policy ? (
        <OwnerTenantPolicy
          locale={locale}
          access={policy.access}
          policy={policy.policy}
          properties={policy.properties}
        />
      ) : !allowed ? (
        <p className="tenant-notice" role="status">
          {ar
            ? 'ليست لديك صلاحية الرد على طلبات المستأجرين في هذه المنشأة.'
            : 'You may not answer tenant requests in this organization.'}
        </p>
      ) : (
        <OwnerTenantRequests
          requests={requests}
          locale={locale}
          focus={focus}
          canRecordPayments={Boolean(claims && canRecordTenantPayments(claims))}
        />
      )}
    </div>
  );
}

export default persistentPortalPage('/owner/tenant-requests', Page);
