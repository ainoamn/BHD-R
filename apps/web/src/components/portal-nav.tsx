'use client';

import { Logo } from '@bhd-r/ui';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import type { PortalRole } from '@/lib/types';

const nav: Record<PortalRole, Array<{ path: string; label: string; mark: string }>> = {
  platform: [
    { path: '', label: 'Common.dashboard', mark: '⌂' },
    { path: '/organizations', label: 'Common.organizations', mark: '◫' },
    { path: '/users', label: 'Common.users', mark: '◎' },
    { path: '/audit', label: 'Common.audit', mark: '≡' },
    { path: '/reports', label: 'Common.reports', mark: '↗' },
    { path: '/settings', label: 'Common.settings', mark: '⚙' },
  ],
  owner: [
    { path: '', label: 'Common.dashboard', mark: '⌂' },
    { path: '/properties', label: 'Common.properties', mark: '▤' },
    { path: '/contracts', label: 'Common.contracts', mark: '✎' },
    { path: '/invoices', label: 'Common.invoices', mark: '▧' },
    { path: '/payments', label: 'Common.payments', mark: '◇' },
    { path: '/maintenance', label: 'Common.maintenance', mark: '◉' },
    { path: '/reports', label: 'Common.reports', mark: '↗' },
    { path: '/team', label: 'Common.team', mark: '◎' },
  ],
  developer: [
    { path: '', label: 'Common.dashboard', mark: '⌂' },
    { path: '/properties', label: 'Common.properties', mark: '▤' },
    { path: '/contracts', label: 'Common.contracts', mark: '✎' },
    { path: '/invoices', label: 'Common.invoices', mark: '▧' },
    { path: '/payments', label: 'Common.payments', mark: '◇' },
    { path: '/maintenance', label: 'Common.maintenance', mark: '◉' },
    { path: '/reports', label: 'Common.reports', mark: '↗' },
    { path: '/team', label: 'Common.team', mark: '◎' },
  ],
  tenant: [
    { path: '', label: 'Common.dashboard', mark: '⌂' },
    { path: '/contracts', label: 'Common.contracts', mark: '✎' },
    { path: '/invoices', label: 'Common.invoices', mark: '▧' },
    { path: '/payments', label: 'Common.payments', mark: '◇' },
    { path: '/maintenance', label: 'Common.maintenance', mark: '◉' },
  ],
};

export function PortalNav({ portal, displayName }: { portal: PortalRole; displayName: string }) {
  const t = useTranslations();
  const pathname = usePathname();
  const locale = useLocale() as 'ar' | 'en';
  const root = `/${portal}`;
  function signOut() {
    window.location.assign('/api/auth/bhd/logout');
  }
  return (
    <aside className="portal-sidebar">
      <div className="portal-sidebar__head">
        <Logo descriptor={t(`Portal.${portal}`)} compact />
      </div>
      <p className="portal-sidebar__title">{t(`Portal.${portal}`)}</p>
      <nav className="portal-nav" aria-label={t(`Portal.${portal}`)}>
        {nav[portal].map((item) => {
          const href = `${root}${item.path}`;
          const active = pathname === href || (item.path !== '' && pathname.startsWith(`${href}/`));
          return (
            <Link key={item.path} href={href} aria-current={active ? 'page' : undefined}>
              <span className="portal-nav__mark" aria-hidden="true">
                {item.mark}
              </span>
              {t(item.label)}
            </Link>
          );
        })}
      </nav>
      <div className="portal-user">
        <strong>{displayName}</strong>
        <Link href={pathname} locale={locale === 'ar' ? 'en' : 'ar'}>
          {locale === 'ar' ? 'English' : 'العربية'}
        </Link>
        <button type="button" onClick={() => void signOut()}>
          {t('Common.signOut')}
        </button>
      </div>
    </aside>
  );
}
