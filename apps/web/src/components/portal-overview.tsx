import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { DashAttentionAlerts } from '@/components/dash-attention-alerts';
import { PortalPendingApprovalsPanel } from '@/components/portal-pending-approvals-panel';
import { formatMoney } from '@/lib/format';
import { loadViewerPendingApprovals } from '@/lib/pending-approvals-neon';
import {
  EMPTY_PENDING_APPROVALS,
  pendingApprovalHref,
  type PendingApprovals,
} from '@/lib/pending-approvals-shared';
import { canOpenPortalPath } from '@/lib/portal-access';
import { loadPortalOverview } from '@/lib/portal-overview-data';
import { loadTenancySummary } from '@/lib/tenancy-neon';
import { withTimeoutFallback } from '@/lib/with-timeout';
import { workflowEventLabel, workflowStatusLabel } from '@/lib/ui-labels';
import { requirePortal } from '@/lib/viewer';
import type { PortalOverview as OverviewData, PortalRole } from '@/lib/types';

function value(input: number | null | undefined, suffix = ''): string {
  if (input === null || input === undefined) return '—';
  return `${input}${suffix}`;
}

function alertCopy(
  code: string,
  count: number,
  t: Awaited<ReturnType<typeof getTranslations>>,
  locale: string,
): string {
  switch (code) {
    case 'open_tickets':
      return t('Portal.alertOpenTickets', { count });
    case 'expiring_leases':
      return t('Portal.alertExpiring', { count });
    case 'open_invoices':
      return t('Portal.alertInvoices', { count });
    case 'vacant_units':
      return t('Portal.alertVacant', { count });
    case 'stay_bookings':
      return t('Portal.alertStayBookings', { count });
    case 'contracts_approval':
      return t('Portal.alertContractsApproval', { count });
    case 'contracts_approval_new':
      return t('Portal.alertNewContractsApproval', { count });
    case 'contracts_approval_renewal':
      return t('Portal.alertRenewalContractsApproval', { count });
    case 'booking_requests':
      return t('Portal.alertBookingRequests', { count });
    case 'viewing_requests':
      return locale === 'ar'
        ? `${count} طلب معاينة بانتظار الموعد`
        : `${count} viewing request${count === 1 ? '' : 's'} awaiting a schedule`;
    case 'paid_reservations':
      return t('Portal.alertPaidReservations', { count });
    case 'deposit_refunds':
      return t('Portal.alertDepositRefunds', { count });
    case 'guest_reviews':
      return t('Portal.alertGuestReviews', { count });
    case 'incomplete_owner_profile':
      return locale === 'ar'
        ? `${count} حقل ناقص في بيانات المالك (اسم، بطاقة، هاتف، نسخة البطاقة/الوكالة)`
        : `${count} missing owner field${count === 1 ? '' : 's'} (name, ID, phone, ID copy / PoA)`;
    case 'incomplete_buildings':
      return locale === 'ar'
        ? `${count} مبنى/عقار ببيانات ناقصة (اسم، موقع، خريطة)`
        : `${count} building${count === 1 ? '' : 's'} with incomplete details (name, location, map)`;
    case 'arrears':
      return locale === 'ar'
        ? `${count} فاتورة متأخرة`
        : `${count} overdue invoice${count === 1 ? '' : 's'}`;
    case 'legal_cases':
      return locale === 'ar'
        ? `${count} قضية قانونية مفتوحة`
        : `${count} open legal case${count === 1 ? '' : 's'}`;
    default:
      return `${code}: ${count}`;
  }
}

function alertHref(portal: PortalRole, code: string, resourceId?: string): string {
  switch (code) {
    case 'open_tickets':
      return `/${portal}/maintenance`;
    case 'expiring_leases':
      return `/${portal}/leasing`;
    case 'open_invoices':
    case 'arrears':
      return `/${portal}/invoices`;
    case 'vacant_units':
      return `/${portal}/bookings`;
    case 'stay_bookings':
      return `/${portal}/bookings?tab=daily`;
    case 'legal_cases':
      return `/${portal}/legal`;
    case 'incomplete_owner_profile': {
      const params = new URLSearchParams({ gaps: 'owner' });
      if (resourceId) params.set('focus', resourceId);
      return `/${portal}/contacts?${params.toString()}`;
    }
    case 'incomplete_buildings':
      return `/${portal}/properties`;
    default:
      return `/${portal}`;
  }
}

function localizeWorkflowLabel(
  key: string | undefined,
  kind: 'event' | 'status',
  locale: string,
): string {
  if (!key) return '';
  return kind === 'event' ? workflowEventLabel(key, locale) : workflowStatusLabel(key, locale);
}

export async function PortalOverview({ locale, portal }: { locale: string; portal: PortalRole }) {
  const managesProperties = portal === 'owner' || portal === 'developer';
  // Data loads read the session themselves; start them alongside the access check.
  const dataPromise: Promise<[OverviewData, PendingApprovals]> = Promise.all([
    loadPortalOverview(portal),
    managesProperties ? loadViewerPendingApprovals() : Promise.resolve(EMPTY_PENDING_APPROVALS),
  ]);
  dataPromise.catch(() => undefined);
  const [t, viewer] = await Promise.all([getTranslations(), requirePortal(locale, portal)]);
  const [[overview, approvals], tenancy] = await Promise.all([
    dataPromise,
    managesProperties
      ? withTimeoutFallback(loadTenancySummary(viewer.id), 2_500, null, 'tenancy-summary')
      : null,
  ]);
  const ar = locale === 'ar';
  const opens = (href: string) =>
    !href.startsWith(`/${portal}`) ||
    canOpenPortalPath(viewer, portal, href.slice(portal.length + 1));
  const contractItems = approvals.items.filter((item) => item.kind === 'contract');
  const renewalTermItems = approvals.items.filter((item) => item.kind === 'renewal_term');
  const newContractItems = contractItems.filter((item) => item.contractKind !== 'renewal');
  const renewalContractItems = [
    ...contractItems.filter((item) => item.contractKind === 'renewal'),
    ...renewalTermItems,
  ];
  const firstNewContract = newContractItems[0] ?? null;
  const firstRenewalContract = renewalContractItems[0] ?? null;
  const firstReservation = approvals.items.find((item) => item.kind === 'lease_reservation');
  const firstRefund = approvals.items.find(
    (item) =>
      item.kind === 'deposit_refund' ||
      item.kind === 'refund_transfer' ||
      item.kind === 'deposit_claim' ||
      item.kind === 'deposit_complaint',
  );
  const firstGuestReview = approvals.items.find((item) => item.kind === 'guest_review');
  const approvalAlerts: Array<{ code: string; count: number; href: string }> = [
    ...(newContractItems.length && firstNewContract
      ? [
          {
            code: 'contracts_approval_new',
            count: newContractItems.length,
            href:
              newContractItems.length === 1
                ? pendingApprovalHref(portal, firstNewContract)
                : `/${portal}#pending-approvals`,
          },
        ]
      : []),
    ...(renewalContractItems.length && firstRenewalContract
      ? [
          {
            code: 'contracts_approval_renewal',
            count: renewalContractItems.length,
            href:
              renewalContractItems.length === 1
                ? pendingApprovalHref(portal, firstRenewalContract)
                : `/${portal}#pending-approvals`,
          },
        ]
      : []),
    ...(approvals.bookings
      ? [{ code: 'booking_requests', count: approvals.bookings, href: `/${portal}/bookings` }]
      : []),
    ...(approvals.viewings
      ? [
          {
            code: 'viewing_requests',
            count: approvals.viewings,
            href:
              approvals.viewings === 1 &&
              approvals.items.find((item) => item.kind === 'viewing_request')
                ? pendingApprovalHref(
                    portal,
                    approvals.items.find((item) => item.kind === 'viewing_request')!,
                  )
                : `/${portal}/bookings`,
          },
        ]
      : []),
    ...(approvals.reservations && firstReservation
      ? [
          {
            code: 'paid_reservations',
            count: approvals.reservations,
            href:
              approvals.reservations === 1
                ? pendingApprovalHref(portal, firstReservation)
                : `/${portal}/bookings`,
          },
        ]
      : []),
    ...(approvals.refunds && firstRefund
      ? [
          {
            code: 'deposit_refunds',
            count: approvals.refunds,
            href:
              approvals.refunds === 1
                ? pendingApprovalHref(portal, firstRefund)
                : `/${portal}#pending-approvals`,
          },
        ]
      : []),
    ...(approvals.reviews && firstGuestReview
      ? [
          {
            code: 'guest_reviews',
            count: approvals.reviews,
            href:
              approvals.reviews === 1
                ? pendingApprovalHref(portal, firstGuestReview)
                : `/${portal}#pending-approvals`,
          },
        ]
      : []),
  ];
  const collected =
    overview.collected ??
    (overview.collectedMinor !== null && overview.collectedMinor !== undefined
      ? [{ amountMinor: overview.collectedMinor, currency: overview.currency ?? 'OMR' }]
      : []);
  const alerts = [...(overview.alerts ?? [])].sort((a, b) => {
    const rank = (severity: 'danger' | 'warning' | 'info') =>
      severity === 'danger' ? 0 : severity === 'warning' ? 1 : 2;
    return rank(a.severity) - rank(b.severity) || b.count - a.count;
  });
  const updatedLabel = overview.generatedAt
    ? new Intl.DateTimeFormat(locale === 'ar' ? 'ar-OM' : 'en-OM', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(overview.generatedAt))
    : null;

  const collectedPrimary = collected[0] ?? null;
  const collectedLabel = collectedPrimary
    ? formatMoney(collectedPrimary.amountMinor, collectedPrimary.currency, locale)
    : '0';
  const financeLinks = [
    { href: `/${portal}/invoices`, label: t('Common.invoices') },
    { href: `/${portal}/payments`, label: t('Common.payments') },
    { href: `/${portal}/expenses`, label: t('Common.expenses') },
  ].filter((link) => opens(link.href));
  /** Primary quick links shown in the hero toolbar (next to add / calendar / reports). */
  const toolbarShortcuts = [
    {
      href: portal === 'tenant' ? `/${portal}/leases` : `/${portal}/leasing`,
      label: t('Common.leasing'),
    },
    ...(portal === 'tenant'
      ? [{ href: `/${portal}/contracts`, label: t('Common.contracts') }]
      : [
          { href: `/${portal}/sales`, label: t('Common.sales') },
          { href: `/${portal}/contracts?kind=purchase`, label: t('Portal.contractsPurchase') },
        ]),
    { href: `/${portal}/invoices`, label: t('Common.invoices') },
    {
      href: portal === 'tenant' ? `/${portal}/reservations` : `/${portal}/bookings`,
      label: t('Common.bookings'),
    },
    { href: `/${portal}/maintenance`, label: t('Common.maintenance') },
  ].filter((link) => opens(link.href));

  // Approvals panel already lists actionable items — keep operational alerts only here.
  const operationalAlerts = alerts.filter(
    (alert) =>
      !['contracts_approval', 'contracts_approval_new', 'contracts_approval_renewal'].includes(
        alert.code,
      ),
  );
  const hasAttention =
    (managesProperties && approvals.total > 0) ||
    approvalAlerts.length > 0 ||
    operationalAlerts.length > 0;
  const showFinance = financeLinks.length > 0 || opens(`/${portal}/accounting`);
  const hasActivity = overview.recentActivity.length > 0;

  const unitsTotal = overview.units ?? 0;
  const vacant = overview.vacantUnits ?? 0;
  const activeLeases = overview.activeLeases ?? 0;
  const expiredContracts = overview.expiredContracts ?? 0;
  const tenantsCount = overview.tenants ?? 0;
  const arrearsCount = overview.arrears ?? 0;
  const ticketsCount = overview.openTickets ?? 0;
  const legalCount = overview.legalCases ?? 0;
  const occupied =
    unitsTotal > 0 ? Math.max(0, unitsTotal - vacant) : activeLeases;
  const occupancyPct =
    overview.occupancyPercent ??
    (unitsTotal > 0 ? Math.round((occupied / unitsTotal) * 100) : 0);
  const leasePct =
    unitsTotal > 0 ? Math.round((activeLeases / unitsTotal) * 100) : 0;
  const vacantPct = unitsTotal > 0 ? Math.round((vacant / unitsTotal) * 100) : 0;
  const occupiedPct = unitsTotal > 0 ? Math.round((occupied / unitsTotal) * 100) : occupancyPct;
  const leaseBase = activeLeases + expiredContracts;
  const expiredPct =
    leaseBase > 0 ? Math.round((expiredContracts / leaseBase) * 100) : expiredContracts > 0 ? 100 : 0;
  const tenantsPct =
    unitsTotal > 0
      ? Math.min(100, Math.round((tenantsCount / unitsTotal) * 100))
      : tenantsCount > 0
        ? Math.min(100, tenantsCount * 12)
        : 0;
  const collectedPct = collectedPrimary && Number(collectedPrimary.amountMinor) > 0 ? 100 : 0;
  const countRingPct = (count: number) =>
    count <= 0 ? 0 : Math.min(100, Math.max(18, count * 14));

  const leasingHref = portal === 'tenant' ? `/${portal}/leases` : `/${portal}/leasing`;
  const rings: Array<{
    key: string;
    label: string;
    value: string;
    percent: number;
    href: string;
    tone: 'teal' | 'navy' | 'gold' | 'forest' | 'amber' | 'coral' | 'rose' | 'slate' | 'wine' | 'olive';
    compact?: boolean;
  }> = [
    {
      key: 'occupancy',
      label: t('Portal.occupancy'),
      value: `${occupancyPct}%`,
      percent: occupancyPct,
      href: `/${portal}/reports`,
      tone: 'teal',
    },
    {
      key: 'occupied',
      label: ar ? 'مشغول' : 'Occupied',
      value: unitsTotal > 0 ? `${occupied}/${unitsTotal}` : value(occupied),
      percent: occupiedPct,
      href: leasingHref,
      tone: 'forest',
    },
    {
      key: 'vacant',
      label: t('Portal.vacantUnits'),
      value: value(overview.vacantUnits ?? null),
      percent: vacantPct,
      href: `/${portal}/properties`,
      tone: 'gold',
    },
    {
      key: 'leases',
      label: t('Portal.activeLeases'),
      value: value(overview.activeLeases ?? null),
      percent: leasePct,
      href: leasingHref,
      tone: 'navy',
    },
    {
      key: 'expired',
      label: ar ? 'عقود منتهية' : 'Expired',
      value: value(overview.expiredContracts ?? null),
      percent: expiredPct || countRingPct(expiredContracts),
      href: leasingHref,
      tone: 'wine',
    },
    {
      key: 'tenants',
      label: ar ? 'المستأجرون' : 'Tenants',
      value: value(overview.tenants ?? null),
      percent: tenantsPct || countRingPct(tenantsCount),
      href: `/${portal}/contacts`,
      tone: 'olive',
    },
    {
      key: 'collected',
      label: t('Portal.collected'),
      value: collectedLabel,
      percent: collectedPct,
      href: `/${portal}/payments`,
      tone: 'amber',
      compact: true,
    },
    {
      key: 'arrears',
      label: ar ? 'المتأخرات' : 'Arrears',
      value: value(overview.arrears ?? null),
      percent: countRingPct(arrearsCount),
      href: `/${portal}/invoices`,
      tone: 'coral',
    },
    {
      key: 'tickets',
      label: ar ? 'الصيانة' : 'Maintenance',
      value: value(overview.openTickets),
      percent: countRingPct(ticketsCount),
      href: `/${portal}/maintenance`,
      tone: 'rose',
    },
    {
      key: 'legal',
      label: ar ? 'القضايا' : 'Legal',
      value: value(overview.legalCases ?? null),
      percent: countRingPct(legalCount),
      href: `/${portal}/legal`,
      tone: 'slate',
    },
  ];

  function renderRing(ring: (typeof rings)[number]) {
    const pct = Math.max(0, Math.min(100, Number.isFinite(ring.percent) ? ring.percent : 0));
    const meter = (
      <div
        className={`dash-ring dash-ring--${ring.tone}${ring.compact ? ' dash-ring--compact' : ''}`}
        style={{
          background: `conic-gradient(var(--dash-ring-fill) ${pct}%, var(--dash-ring-track) 0)`,
        }}
      >
        <div className="dash-ring__core">
          <strong>{ring.value}</strong>
          <span>{ring.label}</span>
        </div>
      </div>
    );
    if (opens(ring.href)) {
      return (
        <Link key={ring.key} href={ring.href} className="dash-ring-link" prefetch>
          {meter}
        </Link>
      );
    }
    return (
      <div key={ring.key} className="dash-ring-link dash-ring-link--static">
        {meter}
      </div>
    );
  }

  return (
    <div className="dash-shell dash-shell--classic">
      <header className="dash-hero dash-hero--classic">
        <div className="dash-hero__copy">
          <p className="dash-hero__kicker">{t(`Portal.${portal}`)}</p>
          <h1>{t('Portal.welcome', { name: viewer.displayName })}</h1>
          {updatedLabel ? (
            <p className="dash-hero__meta">
              {t('Portal.updatedAt')}: {updatedLabel}
            </p>
          ) : (
            <p className="dash-hero__lede">{t('Portal.dashboardIntro')}</p>
          )}
        </div>
        <div className="dash-hero__toolbar" aria-label={t('Portal.quickNav')}>
          <div className="dash-hero__actions">
            {(portal === 'owner' || portal === 'developer') && opens(`/${portal}/properties/new`) ? (
              <Link href={`/${portal}/properties/new`} className="button button--primary" prefetch>
                ＋ {t('Portal.addProperty')}
              </Link>
            ) : null}
            {portal === 'tenant' ? (
              <Link href="/tenant/maintenance/new" className="button button--primary">
                {t('Maintenance.new')}
              </Link>
            ) : null}
            {(portal === 'owner' || portal === 'developer') && opens(`/${portal}/stays/calendar`) ? (
              <Link href={`/${portal}/stays/calendar`} className="button button--quiet" prefetch>
                {t('Portal.openCalendar')}
              </Link>
            ) : null}
            {opens(`/${portal}/reports`) ? (
              <Link href={`/${portal}/reports`} className="button button--quiet">
                {t('Common.reports')}
              </Link>
            ) : null}
          </div>
          {toolbarShortcuts.length ? (
            <nav className="dash-hero__nav" aria-label={t('Portal.quickNav')}>
              {toolbarShortcuts.map((link) => (
                <Link key={link.href} href={link.href} className="dash-hero__nav-link" prefetch>
                  {link.label}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
      </header>

      {tenancy &&
      (tenancy.bookings > 0 ||
        tenancy.contracts > 0 ||
        tenancy.leases > 0 ||
        tenancy.openInvoices > 0) ? (
        <Link href="/tenant" className="dash-tenancy" prefetch>
          <span className="dash-tenancy__copy">
            <strong>
              {ar
                ? 'لديك أيضاً حجوزات وعقود بصفتك مستأجراً أو ضيفاً'
                : 'You also have bookings and contracts as a tenant or guest'}
            </strong>
            <span>
              {[
                tenancy.bookings
                  ? ar
                    ? `${tenancy.bookings} حجز`
                    : `${tenancy.bookings} bookings`
                  : '',
                tenancy.contracts
                  ? ar
                    ? `${tenancy.contracts} عقد`
                    : `${tenancy.contracts} contracts`
                  : '',
                tenancy.leases
                  ? ar
                    ? `${tenancy.leases} إيجار ساري`
                    : `${tenancy.leases} active leases`
                  : '',
                tenancy.openInvoices
                  ? ar
                    ? `${tenancy.openInvoices} فاتورة مستحقة`
                    : `${tenancy.openInvoices} invoices due`
                  : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
          <em className="dash-tenancy__open">{ar ? 'مساحة المستأجر ←' : 'Tenant space →'}</em>
        </Link>
      ) : null}

      <section className="dash-occupancy" aria-label={t('Portal.liveStats')}>
        <div className="dash-section-head dash-section-head--classic">
          <h2>{ar ? 'الاشغال والوحدات' : 'Occupancy & units'}</h2>
          <p className="dash-section-hint">
            {ar
              ? 'اضغط أي دائرة للانتقال إلى الصفحة المرتبطة. الأرقام من محفظتك مباشرة.'
              : 'Tap any circle to open its page. Figures come straight from your portfolio.'}
          </p>
        </div>
        <div className="dash-rings dash-rings--uniform" aria-label={t('Portal.liveStats')}>
          {rings.map((ring) => renderRing(ring))}
        </div>
      </section>

      <section
        className="dash-attention dash-attention--classic"
        aria-label={ar ? 'يحتاج انتباهك' : 'Needs your attention'}
      >
        <div className="dash-section-head dash-section-head--classic">
          <h2>{ar ? 'المواعيد والتنبيهات' : 'Approvals & alerts'}</h2>
          <p className="dash-section-hint">
            {ar
              ? 'التنبيهات يميناً · بانتظار اعتمادك يساراً.'
              : 'Alerts on one side · approvals awaiting you on the other.'}
          </p>
        </div>

        <div className="dash-attention__grid">
          <div className="dash-attention__col dash-attention__col--alerts">
            <div className="dash-attention__col-head">
              <h3>{ar ? 'التنبيهات' : 'Alerts'}</h3>
            </div>
            <DashAttentionAlerts
              emptyLabel={
                !hasAttention && !managesProperties
                  ? t('Portal.noAlerts')
                  : !hasAttention
                    ? t('Portal.noAlerts')
                    : ''
              }
              expandMoreLabel={ar ? 'عرض {count} إضافية' : 'Show {count} more'}
              collapseLabel={ar ? 'عرض أقل' : 'Show less'}
              allHref={`/${portal}/bookings`}
              allLabel={ar ? 'فتح الصفحة كاملة' : 'Open full page'}
              items={[
                ...approvalAlerts.map((alert) => ({
                  key: alert.code,
                  count: alert.count,
                  label: alertCopy(alert.code, alert.count, t, locale),
                  href: alert.href,
                  tone:
                    alert.code === 'contracts_approval_new'
                      ? ('contract-new' as const)
                      : alert.code === 'contracts_approval_renewal'
                        ? ('contract-renewal' as const)
                        : ('approval' as const),
                })),
                ...operationalAlerts.map((alert) => {
                  const href = alertHref(portal, alert.code, alert.resourceId);
                  return {
                    key: alert.code,
                    count: alert.count,
                    label: alertCopy(alert.code, alert.count, t, locale),
                    href: opens(href) ? href : null,
                    tone: alert.severity,
                  };
                }),
              ]}
            />
          </div>
          <div className="dash-attention__col dash-attention__col--approvals">
            {managesProperties ? (
              <PortalPendingApprovalsPanel
                portal={portal}
                locale={locale}
                initial={approvals}
                title={t('Portal.approvalsTitle')}
                hint={t('Portal.approvalsHint')}
                openLabel={t('Portal.approvalsOpen')}
                moreLabel={ar ? 'عرض {count} إضافية' : 'Show {count} more'}
                allHref={`/${portal}/bookings`}
                allLabel={ar ? 'فتح الصفحة كاملة' : 'Open full page'}
              />
            ) : (
              <p className="dash-alerts__empty">{t('Portal.noAlerts')}</p>
            )}
          </div>
        </div>
      </section>

      {showFinance ? (
        <section className="dash-finance dash-finance--classic-solo" aria-label={t('Portal.accountingPulse')}>
          <div className="dash-section-head dash-section-head--classic">
            <h2>{t('Portal.accountingPulse')}</h2>
            {opens(`/${portal}/accounting`) ? (
              <Link href={`/${portal}/accounting`} className="button button--quiet button--tiny">
                {t('Common.accounting')}
              </Link>
            ) : null}
          </div>
          <div className="dash-finance__card dash-finance__card--classic">
            <p>{t('Portal.collected')}</p>
            <strong className="metric-money-stack">
              {collected.length
                ? collected.map((amount) => (
                    <span key={amount.currency}>
                      {formatMoney(amount.amountMinor, amount.currency, locale)}
                    </span>
                  ))
                : '—'}
            </strong>
            <div className="dash-finance__links">
              {financeLinks.map((link) => (
                <Link key={link.href} href={link.href}>
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {hasActivity ? (
        <details className="dash-activity-fold">
          <summary className="dash-activity-fold__summary">
            <span className="dash-activity-fold__title">{t('Portal.recentActivity')}</span>
            <span className="dash-activity-fold__count">{overview.recentActivity.length}</span>
            <span className="dash-activity-fold__hint">
              {ar ? 'اضغط للعرض' : 'Click to expand'}
            </span>
          </summary>
          <ul className="dash-activity">
            {overview.recentActivity.map((item) => {
              const managed = portal === 'owner' || portal === 'developer';
              const href =
                item.resourceType === 'stay_booking' && item.resourceId && managed
                  ? `/${portal}/stays/bookings/${item.resourceId}`
                  : item.resourceType === 'reservation' && managed
                    ? `/${portal}/bookings`
                    : null;
              const body = (
                <>
                  <div>
                    <strong>{localizeWorkflowLabel(item.title, 'event', locale)}</strong>
                    {item.status ? (
                      <span className="dash-activity__status">
                        {localizeWorkflowLabel(item.status, 'status', locale)}
                      </span>
                    ) : null}
                  </div>
                  <time dateTime={item.occurredAt}>
                    {new Intl.DateTimeFormat(locale === 'ar' ? 'ar-OM' : 'en-OM', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(item.occurredAt))}
                  </time>
                </>
              );
              return (
                <li key={item.id}>
                  {href ? (
                    <Link href={href} className="dash-activity__link" prefetch>
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
