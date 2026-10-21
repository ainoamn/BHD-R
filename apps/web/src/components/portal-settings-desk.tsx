import 'server-only';
import { EmptyState } from '@bhd-r/ui';
import { ApprovalPolicyCard } from '@/components/approval-policy-card';
import { StayReschedulePolicyBoard } from '@/components/stay-reschedule-policy-board';
import { Link } from '@/i18n/navigation';
import { DEFAULT_APPROVAL_POLICY } from '@/lib/approval-policy';
import { loadOwnerApprovalPolicy } from '@/lib/approval-policy-neon';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import type { PropertyStaySettingsUnit } from '@/lib/property-stay-settings';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';
import { loadPropertyStaySettingsOnNeon } from '@/lib/stay-setup-neon';
import { readSessionClaimsFromCookies } from '@/lib/stay-setup-session';
import { requirePortal } from '@/lib/viewer';

/**
 * Owner/developer hub for site-wide controls: auto approvals, stay date changes, and
 * shortcuts into team permissions and related org settings.
 */
export async function PortalSettingsDesk({
  locale,
  portal,
}: {
  locale: 'ar' | 'en';
  portal: 'owner' | 'developer';
}) {
  const viewer = await requirePortal(locale, portal);
  const ar = locale === 'ar';
  if (!viewer.organizationId || !hasDatabaseUrl()) {
    return <EmptyState title={ar ? 'لا توجد بيانات' : 'No data'} />;
  }

  const scope = {
    organizationId: viewer.organizationId,
    userId: viewer.id,
    partyId: viewer.partyId ?? null,
    roles: viewer.roles,
  };
  const claims = await readSessionClaimsFromCookies();
  const [approval, stayUnits] = await Promise.all([
    loadOwnerApprovalPolicy(scope, null).catch(() => null),
    claims?.organizationId && isStaysPlatformEnabled()
      ? loadPropertyStaySettingsOnNeon(claims, null).catch(
          (): PropertyStaySettingsUnit[] => [],
        )
      : Promise.resolve([] as PropertyStaySettingsUnit[]),
  ]);

  const links = [
    {
      href: `/${portal}/team`,
      title: ar ? 'الفريق والصلاحيات' : 'Team and permissions',
      hint: ar
        ? 'أدوار مخصّصة، دعوات، وصلاحيات من يعتمد العقود والحجوزات.'
        : 'Custom roles, invites, and who may approve contracts and bookings.',
      mark: '◎',
    },
    {
      href: `/${portal}/terms`,
      title: ar ? 'الشروط والأحكام' : 'Terms and conditions',
      hint: ar
        ? 'نصوص الحجز والشعار، وتخصيص سياسة الاعتماد لكل عقار.'
        : 'Booking copy, letterhead, and per-property approval overrides.',
      mark: '¶',
    },
    {
      href: `/${portal}/notifications`,
      title: ar ? 'قوالب الإشعارات' : 'Notification templates',
      hint: ar ? 'رسائل البريد والتنبيهات للعملاء والفريق.' : 'Email and alert wording for clients and staff.',
      mark: '✉',
    },
    {
      href: `/${portal}/api-keys`,
      title: ar ? 'مفاتيح API' : 'API keys',
      hint: ar ? 'وصول برمجي آمن لتكاملات موقعك وأنظمتك.' : 'Programmatic access for your site and systems.',
      mark: '⌘',
    },
    ...(isStaysPlatformEnabled()
      ? [
          {
            href: `/${portal}/stays/rates`,
            title: ar ? 'الأسعار والعروض' : 'Rates and offers',
            hint: ar
              ? 'أسعار الليالي والفترات والتأمين لكل وحدة إقامة يومية.'
              : 'Nightly, period, and deposit prices for each daily-stay unit.',
            mark: '◇',
          },
        ]
      : []),
    {
      href: `/${portal}/approvals`,
      title: ar ? 'قائمة الاعتمادات' : 'Approvals queue',
      hint: ar
        ? 'ما ينتظر قرارك الآن من حجوزات وتعديلات وعقود.'
        : 'What is waiting on you now — bookings, changes, and contracts.',
      mark: '◎',
    },
  ];

  return (
    <div className="portal-settings" dir={ar ? 'rtl' : 'ltr'}>
      <header className="portal-settings__hero">
        <p className="ops-kicker">{ar ? 'المنظمة' : 'Organization'}</p>
        <h1>{ar ? 'الضبط' : 'Control'}</h1>
        <p>
          {ar
            ? 'اضبط اعتمادات الموقع التلقائية، تعديل تواريخ الإقامات، والصلاحيات من مكان واحد.'
            : 'Set site auto-approvals, daily-stay date changes, and permissions from one place.'}
        </p>
      </header>

      {approval ? (
        <ApprovalPolicyCard
          locale={locale}
          propertyId={null}
          initialPolicy={approval.own?.policy ?? null}
          delegateName={approval.own?.delegate?.name ?? null}
          inherited={{ source: 'default', policy: DEFAULT_APPROVAL_POLICY }}
        />
      ) : (
        <section className="portal-settings__card">
          <h2>{ar ? 'سياسة اعتماد الحجوزات' : 'Booking approval policy'}</h2>
          <p className="notice notice--error" role="alert">
            {ar
              ? 'تعذّر تحميل سياسة الاعتماد — حدّث الصفحة.'
              : 'Could not load the approval policy — refresh the page.'}
          </p>
        </section>
      )}

      {isStaysPlatformEnabled() ? (
        <StayReschedulePolicyBoard locale={locale} units={stayUnits} />
      ) : (
        <section className="portal-settings__card" aria-labelledby="stay-reschedule-fallback">
          <h2 id="stay-reschedule-fallback">
            {ar ? 'اعتماد تعديل الحجز (التواريخ / الفترة)' : 'Approve booking changes (dates / period)'}
          </h2>
          <p className="muted">
            {ar
              ? 'اضبطه من خطوة «اعتماد تعديل الحجز» في سياسة الاعتماد أعلاه. بعد تفعيل الإقامات اليومية تُطبَّق على كل الوحدات.'
              : 'Set it with the “Approve booking changes” step in the approval policy above. Once daily stays are enabled it applies to every unit.'}
          </p>
        </section>
      )}

      <section className="portal-settings__card" aria-labelledby="settings-links-title">
        <h2 id="settings-links-title">{ar ? 'إعدادات مرتبطة' : 'Related settings'}</h2>
        <p className="muted">
          {ar
            ? 'الصلاحيات والشروط والإشعارات تبقى في صفحاتها؛ افتحها من هنا عند الحاجة.'
            : 'Permissions, terms, and notifications stay on their pages — open them from here when needed.'}
        </p>
        <ul className="portal-settings__links">
          {links.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="portal-settings__link">
                <span className="portal-settings__mark" aria-hidden="true">
                  {item.mark}
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <em>{item.hint}</em>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
