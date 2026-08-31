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

          <BhdAppSwitcher viewer={viewer} locale={locale} />
        </div>
      </div>
    </header>
  );
}
