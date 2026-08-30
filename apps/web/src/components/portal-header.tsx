'use client';

import { Logo } from '@bhd-r/ui';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { BhdAppSwitcher } from '@/components/bhd-app-switcher';
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
  const initial = viewer.displayName.trim().slice(0, 1).toUpperCase() || 'B';
  const subtitle = viewer.email ?? viewer.username ?? (ar ? 'حساب BHD' : 'BHD account');
  const roleLabel = viewer.roles[0]?.replace(/_/g, ' ') ?? t(`Portal.${portal}`);

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
            <Logo descriptor="" compact />
          </Link>
          <div className="portal-chrome__titles">
            <strong>BHD R</strong>
            <span>{t(`Portal.${portal}`)}</span>
          </div>
        </div>

        <div className="portal-chrome__actions">
          <Link
            href={pathname}
            locale={nextLocale}
            className="portal-chrome__lang"
            hrefLang={nextLocale}
            lang={nextLocale}
          >
            <span className="portal-chrome__lang-code">{nextLocale.toUpperCase()}</span>
            <span>{ar ? 'English' : 'العربية'}</span>
          </Link>

          <div
            className="portal-chrome__user"
            title={`${viewer.displayName} · ${subtitle}`}
            aria-label={`${viewer.displayName}, ${roleLabel}, ${subtitle}`}
          >
            <span className="portal-chrome__avatar" aria-hidden="true">
              {initial}
            </span>
            <div className="portal-chrome__user-text">
              <strong>{viewer.displayName}</strong>
              <small>
                <span className="portal-chrome__role">{roleLabel}</span>
                <span className="portal-chrome__dot" aria-hidden="true">
                  ·
                </span>
                <span>{subtitle}</span>
              </small>
            </div>
          </div>

          <BhdAppSwitcher viewer={viewer} locale={locale} />
        </div>
      </div>
    </header>
  );
}
