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
    case 'missing_rent_bank':
      return locale === 'ar'
        ? `${count} عقار بلا حساب بنكي مكتمل لمستفيد شيكات الإيجار (اسم المستفيد، البنك، رقم الحساب)`
        : `${count} propert${count === 1 ? 'y' : 'ies'} missing a complete rent cheque payee bank account`;
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
    case 'missing_rent_bank':
      return `/${portal}/accounting?tab=settings`;
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

/**
 * Owner dashboard — ground-up redesign ("obd" = owner board).
 *
 * Same data sources and access rules as the classic PortalOverview, but a
 * completely new layout: dark command hero with quick links, a KPI strip of
 * progress-bar stat cards, an attention/approvals duo, a dark finance panel
 * and an activity timeline. Used ONLY by /owner (developer & platform keep
 * the classic overview) so this file is free to evolve its own design system
 * (see portal-dashboard-modern.css, "OWNER BOARD" section).
 */
export async function OwnerDashboard({ locale }: { locale: string }) {
  const portal: PortalRole = 'owner';
  const dataPromise: Promise<[OverviewData, PendingApprovals]> = Promise.all([
    loadPortalOverview(portal),
    loadViewerPendingApprovals(),
  ]);
  dataPromise.catch(() => undefined);
  const [t, viewer] = await Promise.all([getTranslations(), requirePortal(locale, portal)]);
  const [[overview, approvals], tenancy] = await Promise.all([
    dataPromise,
    withTimeoutFallback(loadTenancySummary(viewer.id), 2_500, null, 'tenancy-summary'),
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
  const quickLinks = [
    { href: `/${portal}/leasing`, label: t('Common.leasing') },
    { href: `/${portal}/sales`, label: t('Common.sales') },
    { href: `/${portal}/contracts?kind=purchase`, label: t('Portal.contractsPurchase') },
    { href: `/${portal}/invoices`, label: t('Common.invoices') },
    { href: `/${portal}/bookings`, label: t('Common.bookings') },
    { href: `/${portal}/maintenance`, label: t('Common.maintenance') },
  ].filter((link) => opens(link.href));

  const operationalAlerts = alerts.filter(
    (alert) =>
      !['contracts_approval', 'contracts_approval_new', 'contracts_approval_renewal'].includes(
        alert.code,
      ),
  );
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
  const occupied = unitsTotal > 0 ? Math.max(0, unitsTotal - vacant) : activeLeases;
  const occupancyPct =
    overview.occupancyPercent ??
    (unitsTotal > 0 ? Math.round((occupied / unitsTotal) * 100) : 0);
  const leasePct = unitsTotal > 0 ? Math.round((activeLeases / unitsTotal) * 100) : 0;
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
  const countPct = (count: number) => (count <= 0 ? 0 : Math.min(100, Math.max(18, count * 14)));

  type Tone = 'teal' | 'navy' | 'gold' | 'forest' | 'amber' | 'coral' | 'rose' | 'slate' | 'wine' | 'olive';
  const stats: Array<{
    key: string;
    label: string;
    value: string;
    percent: number;
    href: string;
    tone: Tone;
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
      href: `/${portal}/leasing`,
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
      href: `/${portal}/leasing`,
      tone: 'navy',
    },
    {
      key: 'expired',
      label: ar ? 'عقود منتهية' : 'Expired',
      value: value(overview.expiredContracts ?? null),
      percent: expiredPct || countPct(expiredContracts),
      href: `/${portal}/leasing`,
      tone: 'wine',
    },
    {
      key: 'tenants',
      label: ar ? 'المستأجرون' : 'Tenants',
      value: value(overview.tenants ?? null),
      percent: tenantsPct || countPct(tenantsCount),
      href: `/${portal}/contacts`,
      tone: 'olive',
    },
    {
      key: 'arrears',
      label: ar ? 'المتأخرات' : 'Arrears',
      value: value(overview.arrears ?? null),
      percent: countPct(arrearsCount),
      href: `/${portal}/invoices`,
      tone: 'coral',
    },
    {
      key: 'tickets',
      label: ar ? 'الصيانة' : 'Maintenance',
      value: value(overview.openTickets),
      percent: countPct(ticketsCount),
      href: `/${portal}/maintenance`,
      tone: 'rose',
    },
    {
      key: 'legal',
      label: ar ? 'القضايا' : 'Legal',
      value: value(overview.legalCases ?? null),
      percent: countPct(legalCount),
      href: `/${portal}/legal`,
      tone: 'slate',
    },
  ];

  const todayLabel = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-OM' : 'en-OM', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  return (
    <div className="obd">
      {/* ── Command hero ─────────────────────────────────────────── */}
      <header className="obd-hero">
        <div className="obd-hero__inner">
          <div className="obd-hero__copy">
            <p className="obd-kicker">
              {t('Portal.owner')} <span className="obd-kicker__dot" aria-hidden="true" /> {todayLabel}
            </p>
            <h1 className="obd-hero__title">{t('Portal.welcome', { name: viewer.displayName })}</h1>
            <p className="obd-hero__sub">
              {updatedLabel
                ? `${t('Portal.updatedAt')}: ${updatedLabel}`
                : t('Portal.dashboardIntro')}
            </p>
          </div>
          <div className="obd-hero__actions">
            {opens(`/${portal}/properties/new`) ? (
              <Link href={`/${portal}/properties/new`} className="obd-btn obd-btn--gold" prefetch>
                ＋ {t('Portal.addProperty')}
              </Link>
            ) : null}
            {opens(`/${portal}/stays/calendar`) ? (
              <Link href={`/${portal}/stays/calendar`} className="obd-btn obd-btn--glass" prefetch>
                {t('Portal.openCalendar')}
              </Link>
            ) : null}
            {opens(`/${portal}/reports`) ? (
              <Link href={`/${portal}/reports`} className="obd-btn obd-btn--glass">
                {t('Common.reports')}
              </Link>
            ) : null}
          </div>
        </div>
        {quickLinks.length ? (
          <nav className="obd-quick" aria-label={t('Portal.quickNav')}>
            {quickLinks.map((link) => (
              <Link key={link.href} href={link.href} className="obd-quick__link" prefetch>
                {link.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>

      {/* ── Cross-space tenancy banner ───────────────────────────── */}
      {tenancy &&
      (tenancy.bookings > 0 ||
        tenancy.contracts > 0 ||
        tenancy.leases > 0 ||
        tenancy.openInvoices > 0) ? (
        <Link href="/tenant" className="obd-tenancy" prefetch>
          <span className="obd-tenancy__copy">
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
          <em className="obd-tenancy__open">{ar ? 'مساحة المستأجر ←' : 'Tenant space →'}</em>
        </Link>
      ) : null}

      {/* ── KPI strip ────────────────────────────────────────────── */}
      <section className="obd-stats" aria-label={t('Portal.liveStats')}>
        {stats.map((stat) => {
          const pct = Math.max(0, Math.min(100, Number.isFinite(stat.percent) ? stat.percent : 0));
          const body = (
            <>
              <span className="obd-stat__head">
                <span className="obd-stat__label">{stat.label}</span>
                <span className="obd-stat__spark" aria-hidden="true">
                  <i style={{ inlineSize: `${pct}%` }} />
                </span>
              </span>
              <strong className="obd-stat__value">{stat.value}</strong>
              <span className="obd-stat__bar" aria-hidden="true">
                <i style={{ inlineSize: `${pct}%` }} />
              </span>
            </>
          );
          if (opens(stat.href)) {
            return (
              <Link
                key={stat.key}
                href={stat.href}
                className={`obd-stat obd-stat--${stat.tone}`}
                prefetch
              >
                {body}
              </Link>
            );
          }
          return (
            <div key={stat.key} className={`obd-stat obd-stat--${stat.tone} obd-stat--static`}>
              {body}
            </div>
          );
        })}
      </section>

      {/* ── Attention + approvals ────────────────────────────────── */}
      <div className="obd-duo">
        <section className="obd-card" aria-label={ar ? 'التنبيهات' : 'Alerts'}>
          <div className="obd-card__head">
            <h2>{ar ? 'التنبيهات' : 'Alerts'}</h2>
            <Link href={`/${portal}/bookings`} className="obd-card__more">
              {ar ? 'فتح الصفحة كاملة' : 'Open full page'}
            </Link>
          </div>
          <DashAttentionAlerts
            emptyLabel={t('Portal.noAlerts')}
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
        </section>

        <section className="obd-card" aria-label={t('Portal.approvalsTitle')} id="pending-approvals">
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
        </section>
      </div>

      {/* ── Finance panel ────────────────────────────────────────── */}
      {showFinance ? (
        <section className="obd-finance" aria-label={t('Portal.accountingPulse')}>
          <div className="obd-finance__main">
            <p className="obd-finance__kicker">{t('Portal.accountingPulse')}</p>
            <p className="obd-finance__label">{t('Portal.collected')}</p>
            <strong className="obd-finance__value metric-money-stack">
              {collected.length
                ? collected.map((amount) => (
                    <span key={amount.currency}>
                      {formatMoney(amount.amountMinor, amount.currency, locale)}
                    </span>
                  ))
                : '—'}
            </strong>
          </div>
          <div className="obd-finance__side">
            {financeLinks.map((link) => (
              <Link key={link.href} href={link.href} className="obd-finance__link">
                {link.label}
              </Link>
            ))}
            {opens(`/${portal}/accounting`) ? (
              <Link href={`/${portal}/accounting`} className="obd-finance__link obd-finance__link--accent">
                {t('Common.accounting')}
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* ── Activity timeline ────────────────────────────────────── */}
      {hasActivity ? (
        <details className="obd-activity">
          <summary className="obd-activity__summary">
            <span className="obd-activity__title">{t('Portal.recentActivity')}</span>
            <span className="obd-activity__meta">
              <span className="obd-activity__count">{overview.recentActivity.length}</span>
              <span className="obd-activity__hint">{ar ? 'اضغط للعرض' : 'Click to expand'}</span>
            </span>
          </summary>
          <ul className="obd-timeline">
            {overview.recentActivity.map((item) => {
              const href =
                item.resourceType === 'stay_booking' && item.resourceId
                  ? `/${portal}/stays/bookings/${item.resourceId}`
                  : item.resourceType === 'reservation'
                    ? `/${portal}/bookings`
                    : null;
              const body = (
                <>
                  <span className="obd-timeline__dot" aria-hidden="true" />
                  <span className="obd-timeline__body">
                    <strong>{localizeWorkflowLabel(item.title, 'event', locale)}</strong>
                    {item.status ? (
                      <span className="obd-timeline__status">
                        {localizeWorkflowLabel(item.status, 'status', locale)}
                      </span>
                    ) : null}
                  </span>
                  <time dateTime={item.occurredAt}>
                    {new Intl.DateTimeFormat(locale === 'ar' ? 'ar-OM' : 'en-OM', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(item.occurredAt))}
                  </time>
                </>
              );
              return (
                <li key={item.id} className="obd-timeline__item">
                  {href ? (
                    <Link href={href} className="obd-timeline__link" prefetch>
                      {body}
                    </Link>
                  ) : (
                    <span className="obd-timeline__link obd-timeline__link--static">{body}</span>
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
