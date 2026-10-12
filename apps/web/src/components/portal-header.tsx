'use client';

import { Logo } from '@bhd-r/ui';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { BhdAppSwitcher } from '@/components/bhd-app-switcher';
import { PortalApprovalsBell } from '@/components/portal-approvals-bell';
import type { PortalRole, Viewer } from '@/lib/types';

export function PortalHeader({
  portal,
  viewer,
  onOpenNav,
  navOpen = false,
  navPanelId,
}: {
  portal: PortalRole;
  viewer: Viewer;
  onOpenNav?: () => void;
  navOpen?: boolean;
  navPanelId?: string;
}) {
  const t = useTranslations();
  const locale = useLocale() as 'ar' | 'en';
  const pathname = usePathname();
  const ar = locale === 'ar';
  const nextLocale = locale === 'ar' ? 'en' : 'ar';
  const managerPortal = viewer.portals.find((role) => role === 'owner' || role === 'developer');
  const showSpaceSwitch =
    portal !== 'platform' && Boolean(managerPortal) && viewer.portals.includes('tenant');

  return (
    <header className="portal-chrome">
      <div className="oman-flag-line" aria-hidden="true" />
      <div className="portal-chrome__row">
        <div className="portal-chrome__brand">
          {onOpenNav ? (
            <button
              type="button"
              className="portal-chrome__menu"
              aria-label={ar ? 'فتح القائمة' : 'Open menu'}
              aria-expanded={navOpen}
              aria-controls={navPanelId}
              onClick={onOpenNav}
            >
              <span aria-hidden="true">{navOpen ? '×' : '☰'}</span>
            </button>
          ) : null}
          <Link href={`/${portal}`} className="portal-chrome__logo" aria-label="BHD R">
            <Logo descriptor={t(`Portal.${portal}`)} />
          </Link>
        </div>

        <div className="portal-chrome__actions">
          {showSpaceSwitch && managerPortal ? (
            <nav className="portal-space-switch" aria-label={ar ? 'تبديل المساحة' : 'Switch space'}>
              <Link
                href={`/${managerPortal}`}
                aria-current={portal !== 'tenant' ? 'page' : undefined}
                title={
                  ar
                    ? 'مساحة المالك: العقارات التي تؤجّرها أو تديرها'
                    : 'Owner space: properties you let or manage'
                }
              >
                {managerPortal === 'developer'
                  ? ar
                    ? 'المطوّر'
                    : 'Developer'
                  : ar
                    ? 'المالك'
                    : 'Owner'}
              </Link>
              <Link
                href="/tenant"
                aria-current={portal === 'tenant' ? 'page' : undefined}
                title={
                  ar
                    ? 'مساحة المستأجر: ما استأجرته أو حجزته'
                    : 'Tenant space: what you rent or booked'
                }
              >
                {ar ? 'المستأجر' : 'Tenant'}
              </Link>
            </nav>
          ) : null}
          <Link
            href={pathname}
            locale={nextLocale}
            className="portal-chrome__lang"
            hrefLang={nextLocale}
            lang={nextLocale}
            title={ar ? 'English' : 'العربية'}
            aria-label={ar ? 'Switch to English' : 'التبديل إلى العربية'}
          >
            <span className="portal-chrome__lang-code">{nextLocale.toUpperCase()}</span>
          </Link>

          {portal === 'owner' || portal === 'developer' ? (
            <PortalApprovalsBell portal={portal} locale={locale} />
          ) : null}

          <BhdAppSwitcher viewer={viewer} locale={locale} />
        </div>
      </div>
    </header>
  );
}
