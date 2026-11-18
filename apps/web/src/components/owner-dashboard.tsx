import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { DashAttentionAlerts } from '@/components/dash-attention-alerts';
import { PortalPendingApprovalsPanel } from '@/components/portal-pending-approvals-panel';
import { formatMoney } from '@/lib/format';
import { loadViewerPendingApprovals } from '@/lib/pending-approvals-neon';
import {
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

type Tone = 'teal' | 'navy' | 'gold' | 'forest' | 'amber' | 'coral' | 'rose' | 'slate' | 'wine' | 'olive';

function RingMeter({
  valueLabel,
  label,
  percent,
  tone,
  size = 'md',
}: {
  valueLabel: string;
  label: string;
  percent: number;
  tone: Tone;
  size?: 'lg' | 'md' | 'sm';
}) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  return (
    <div
      className={`obd-ring obd-ring--${size} obd-ring--${tone}`}
      style={{
        background: `conic-gradient(var(--obd-ring-fill) ${pct}%, var(--obd-ring-track) 0)`,
      }}
      aria-label={`${label}: ${valueLabel}`}
    >
      <div className="obd-ring__core">
        <strong>{valueLabel}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

/**
 * Owner executive dashboard — TailAdmin / Aniq-style composition.
 * Same data & access rules as PortalOverview; owner-only visual layer.
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
  const collectedPct = collectedPrimary && Number(collectedPrimary.amountMinor) > 0 ? 100 : 0;
  const countPct = (count: number) => (count <= 0 ? 0 : Math.min(100, Math.max(18, count * 14)));

  const attentionCount = approvals.total + operationalAlerts.length + approvalAlerts.length;

  const kpis: Array<{
    key: string;
    label: string;
    value: string;
    hint: string;
    href: string;
    tone: Tone;
    percent: number;
  }> = [
    {
      key: 'occupancy',
      label: t('Portal.occupancy'),
      value: `${occupancyPct}%`,
      hint: ar ? 'نسبة الإشغال الحالية' : 'Current occupancy rate',
      href: `/${portal}/reports`,
      tone: 'teal',
      percent: occupancyPct,
    },
    {
      key: 'units',
      label: ar ? 'الوحدات المشغولة' : 'Occupied units',
      value: unitsTotal > 0 ? `${occupied}/${unitsTotal}` : value(occupied),
      hint: ar ? 'مشغول من إجمالي الوحدات' : 'Occupied of total units',
      href: `/${portal}/leasing`,
      tone: 'forest',
      percent: occupiedPct,
    },
    {
      key: 'leases',
      label: t('Portal.activeLeases'),
      value: value(overview.activeLeases ?? null),
      hint: ar ? 'عقود إيجار سارية' : 'Active lease contracts',
      href: `/${portal}/leasing`,
      tone: 'navy',
      percent: leasePct,
    },
    {
      key: 'collected',
      label: t('Portal.collected'),
      value: collectedLabel,
      hint: ar ? 'التحصيل المسجّل' : 'Recorded collections',
      href: `/${portal}/payments`,
      tone: 'amber',
      percent: collectedPct || 12,
    },
  ];

  const ringStats: Array<{
    key: string;
    label: string;
    value: string;
    percent: number;
    href: string;
    tone: Tone;
  }> = [
    {
      key: 'vacant',
      label: t('Portal.vacantUnits'),
      value: value(overview.vacantUnits ?? null),
      percent: vacantPct,
      href: `/${portal}/properties`,
      tone: 'gold',
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
      <header className="obd-head">
        <div className="obd-head__copy">
          <p className="obd-head__kicker">
            {t('Portal.owner')}
            <span aria-hidden="true">·</span>
            {todayLabel}
          </p>
          <h1>{t('Portal.welcome', { name: viewer.displayName })}</h1>
          <p className="obd-head__meta">
            {updatedLabel
              ? `${t('Portal.updatedAt')}: ${updatedLabel}`
              : t('Portal.dashboardIntro')}
          </p>
        </div>
        <div className="obd-head__actions">
          {opens(`/${portal}/properties/new`) ? (
            <Link href={`/${portal}/properties/new`} className="obd-btn obd-btn--solid" prefetch>
              ＋ {t('Portal.addProperty')}
            </Link>
          ) : null}
          {opens(`/${portal}/stays/calendar`) ? (
            <Link href={`/${portal}/stays/calendar`} className="obd-btn obd-btn--line" prefetch>
              {t('Portal.openCalendar')}
            </Link>
          ) : null}
          {opens(`/${portal}/reports`) ? (
            <Link href={`/${portal}/reports`} className="obd-btn obd-btn--line">
              {t('Common.reports')}
            </Link>
          ) : null}
        </div>
      </header>

      <section className="obd-kpis" aria-label={t('Portal.liveStats')}>
        {kpis.map((kpi) => {
          const body = (
            <>
              <div className="obd-kpi__text">
                <span className="obd-kpi__label">{kpi.label}</span>
                <strong className="obd-kpi__value">{kpi.value}</strong>
                <span className="obd-kpi__hint">{kpi.hint}</span>
              </div>
              <RingMeter
                valueLabel={`${Math.round(kpi.percent)}%`}
                label=""
                percent={kpi.percent}
                tone={kpi.tone}
                size="sm"
              />
            </>
          );
          if (opens(kpi.href)) {
            return (
              <Link key={kpi.key} href={kpi.href} className={`obd-kpi obd-kpi--${kpi.tone}`} prefetch>
                {body}
              </Link>
            );
          }
          return (
            <div key={kpi.key} className={`obd-kpi obd-kpi--${kpi.tone} is-static`}>
              {body}
            </div>
          );
        })}
      </section>

      <div className="obd-main">
        <section className="obd-panel obd-panel--insights" aria-label={ar ? 'مؤشرات المحفظة' : 'Portfolio insights'}>
          <div className="obd-panel__head">
            <div>
              <h2>{ar ? 'مؤشرات المحفظة' : 'Portfolio insights'}</h2>
              <p>{ar ? 'اضغط أي مؤشر للانتقال إلى الصفحة المرتبطة.' : 'Tap any metric to open its linked page.'}</p>
            </div>
            {opens(`/${portal}/reports`) ? (
              <Link href={`/${portal}/reports`} className="obd-panel__link">
                {ar ? 'التقارير' : 'Reports'}
              </Link>
            ) : null}
          </div>

          <div className="obd-insights">
            <div className="obd-insights__hero">
              {opens(`/${portal}/reports`) ? (
                <Link href={`/${portal}/reports`} className="obd-ring-link" prefetch>
                  <RingMeter
                    valueLabel={`${occupancyPct}%`}
                    label={t('Portal.occupancy')}
                    percent={occupancyPct}
                    tone="teal"
                    size="lg"
                  />
                </Link>
              ) : (
                <RingMeter
                  valueLabel={`${occupancyPct}%`}
                  label={t('Portal.occupancy')}
                  percent={occupancyPct}
                  tone="teal"
                  size="lg"
                />
              )}
              <ul className="obd-insights__legend">
                <li>
                  <i className="obd-dot obd-dot--forest" aria-hidden="true" />
                  <span>{ar ? 'مشغول' : 'Occupied'}</span>
                  <strong>{unitsTotal > 0 ? `${occupied}/${unitsTotal}` : value(occupied)}</strong>
                </li>
                <li>
                  <i className="obd-dot obd-dot--gold" aria-hidden="true" />
                  <span>{t('Portal.vacantUnits')}</span>
                  <strong>{value(overview.vacantUnits ?? null)}</strong>
                </li>
                <li>
                  <i className="obd-dot obd-dot--navy" aria-hidden="true" />
                  <span>{t('Portal.activeLeases')}</span>
                  <strong>{value(overview.activeLeases ?? null)}</strong>
                </li>
              </ul>
            </div>

            <div className="obd-rings" aria-label={t('Portal.liveStats')}>
              {ringStats.map((stat) => {
                const meter = (
                  <RingMeter
                    valueLabel={stat.value}
                    label={stat.label}
                    percent={stat.percent}
                    tone={stat.tone}
                    size="md"
                  />
                );
                if (opens(stat.href)) {
                  return (
                    <Link key={stat.key} href={stat.href} className="obd-ring-link" prefetch>
                      {meter}
                    </Link>
                  );
                }
                return (
                  <div key={stat.key} className="obd-ring-link is-static">
                    {meter}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {showFinance ? (
          <section className="obd-panel obd-panel--finance" aria-label={t('Portal.accountingPulse')}>
            <div className="obd-panel__head">
              <div>
                <h2>{t('Portal.accountingPulse')}</h2>
                <p>{ar ? 'ملخص التحصيل وروابط الحسابات.' : 'Collections snapshot and accounting links.'}</p>
              </div>
            </div>
            <div className="obd-finance">
              <RingMeter
                valueLabel={collectedPct ? '100%' : '0%'}
                label={t('Portal.collected')}
                percent={collectedPct || 8}
                tone="amber"
                size="lg"
              />
              <div className="obd-finance__body">
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
                <div className="obd-finance__stats">
                  <div>
                    <span>{ar ? 'بانتظار انتباهك' : 'Needs attention'}</span>
                    <strong>{attentionCount}</strong>
                  </div>
                  <div>
                    <span>{ar ? 'المتأخرات' : 'Arrears'}</span>
                    <strong>{value(overview.arrears ?? null)}</strong>
                  </div>
                </div>
                <div className="obd-finance__links">
                  {financeLinks.map((link) => (
                    <Link key={link.href} href={link.href} className="obd-chip">
                      {link.label}
                    </Link>
                  ))}
                  {opens(`/${portal}/accounting`) ? (
                    <Link href={`/${portal}/accounting`} className="obd-chip obd-chip--accent">
                      {t('Common.accounting')}
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </div>

      <div className="obd-split">
        <section className="obd-panel obd-panel--approvals" aria-label={t('Portal.approvalsTitle')} id="pending-approvals">
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

        <section className="obd-panel obd-panel--alerts" aria-label={ar ? 'التنبيهات' : 'Alerts'}>
          <div className="obd-panel__head">
            <div>
              <h2>{ar ? 'التنبيهات' : 'Alerts'}</h2>
              <p>{ar ? 'ما يحتاج متابعة تشغيلية الآن.' : 'Operational items that need follow-up.'}</p>
            </div>
            <Link href={`/${portal}/bookings`} className="obd-panel__link">
              {ar ? 'فتح' : 'Open'}
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
      </div>

      {(quickLinks.length > 0 ||
        (tenancy &&
          (tenancy.bookings > 0 ||
            tenancy.contracts > 0 ||
            tenancy.leases > 0 ||
            tenancy.openInvoices > 0)) ||
        hasActivity) && (
        <div className="obd-bottom">
          {quickLinks.length ? (
            <nav className="obd-panel obd-panel--quick" aria-label={t('Portal.quickNav')}>
              <div className="obd-panel__head">
                <div>
                  <h2>{t('Portal.quickNav')}</h2>
                  <p>{ar ? 'اختصارات التشغيل اليومية.' : 'Daily operations shortcuts.'}</p>
                </div>
              </div>
              <div className="obd-quick">
                {quickLinks.map((link) => (
                  <Link key={link.href} href={link.href} className="obd-chip" prefetch>
                    {link.label}
                  </Link>
                ))}
              </div>
            </nav>
          ) : null}

          {tenancy &&
          (tenancy.bookings > 0 ||
            tenancy.contracts > 0 ||
            tenancy.leases > 0 ||
            tenancy.openInvoices > 0) ? (
            <Link href="/tenant" className="obd-panel obd-panel--tenancy" prefetch>
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
              <em>{ar ? 'مساحة المستأجر ←' : 'Tenant space →'}</em>
            </Link>
          ) : null}

          {hasActivity ? (
            <details className="obd-panel obd-panel--activity">
              <summary>
                <span>
                  <strong>{t('Portal.recentActivity')}</strong>
                  <em>{overview.recentActivity.length}</em>
                </span>
                <span className="obd-panel__hint">{ar ? 'اضغط للعرض' : 'Click to expand'}</span>
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
                          <span>{localizeWorkflowLabel(item.status, 'status', locale)}</span>
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
                    <li key={item.id}>
                      {href ? (
                        <Link href={href} className="obd-timeline__link" prefetch>
                          {body}
                        </Link>
                      ) : (
                        <span className="obd-timeline__link is-static">{body}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          ) : null}
        </div>
      )}
    </div>
  );
}
