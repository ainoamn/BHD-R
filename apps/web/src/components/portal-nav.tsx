'use client';

import { Logo } from '@bhd-r/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
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
    { path: '/contacts', label: 'Common.contacts', mark: '◎' },
    { path: '/requests', label: 'Common.requests', mark: '◌' },
    { path: '/bookings', label: 'Common.bookings', mark: '⌁' },
    { path: '/leasing', label: 'Common.leasing', mark: '⌂' },
    { path: '/sales', label: 'Common.sales', mark: '◆' },
    { path: '/contracts', label: 'Common.contracts', mark: '✎' },
    { path: '/invoices', label: 'Common.invoices', mark: '▧' },
    { path: '/payments', label: 'Common.payments', mark: '◇' },
    { path: '/accounting', label: 'Common.accounting', mark: '∑' },
    { path: '/expenses', label: 'Common.expenses', mark: '↘' },
    { path: '/maintenance', label: 'Common.maintenance', mark: '◉' },
    { path: '/work-orders', label: 'Common.workOrders', mark: '⚒' },
    { path: '/tasks', label: 'Common.tasks', mark: '✓' },
    { path: '/legal', label: 'Common.legalCases', mark: '§' },
    { path: '/approvals', label: 'Common.approvals', mark: '◎' },
    { path: '/reports', label: 'Common.reports', mark: '↗' },
    { path: '/team', label: 'Common.team', mark: '◎' },
    { path: '/api-keys', label: 'Common.apiKeys', mark: '⌘' },
  ],
  developer: [
    { path: '', label: 'Common.dashboard', mark: '⌂' },
    { path: '/properties', label: 'Common.properties', mark: '▤' },
    { path: '/contacts', label: 'Common.contacts', mark: '◎' },
    { path: '/requests', label: 'Common.requests', mark: '◌' },
    { path: '/bookings', label: 'Common.bookings', mark: '⌁' },
    { path: '/leasing', label: 'Common.leasing', mark: '⌂' },
    { path: '/sales', label: 'Common.sales', mark: '◆' },
    { path: '/contracts', label: 'Common.contracts', mark: '✎' },
    { path: '/invoices', label: 'Common.invoices', mark: '▧' },
    { path: '/payments', label: 'Common.payments', mark: '◇' },
    { path: '/accounting', label: 'Common.accounting', mark: '∑' },
    { path: '/expenses', label: 'Common.expenses', mark: '↘' },
    { path: '/maintenance', label: 'Common.maintenance', mark: '◉' },
    { path: '/work-orders', label: 'Common.workOrders', mark: '⚒' },
    { path: '/tasks', label: 'Common.tasks', mark: '✓' },
    { path: '/legal', label: 'Common.legalCases', mark: '§' },
    { path: '/approvals', label: 'Common.approvals', mark: '◎' },
    { path: '/reports', label: 'Common.reports', mark: '↗' },
    { path: '/team', label: 'Common.team', mark: '◎' },
    { path: '/api-keys', label: 'Common.apiKeys', mark: '⌘' },
  ],
  tenant: [
    { path: '', label: 'Common.dashboard', mark: '⌂' },
    { path: '/reservations', label: 'Common.bookings', mark: '⌁' },
    { path: '/contracts', label: 'Common.contracts', mark: '✎' },
    { path: '/leases', label: 'Common.leasing', mark: '⌂' },
    { path: '/invoices', label: 'Common.invoices', mark: '▧' },
    { path: '/payments', label: 'Common.payments', mark: '◇' },
    { path: '/maintenance', label: 'Common.maintenance', mark: '◉' },
    { path: '/requests', label: 'Common.requests', mark: '◌' },
  ],
};

export function PortalNav({ portal, displayName }: { portal: PortalRole; displayName: string }) {
  const t = useTranslations();
  const pathname = usePathname();
  const locale = useLocale() as 'ar' | 'en';
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = `/${portal}`;
  const activeItem =
    nav[portal].find(
      (item) =>
        pathname === `${root}${item.path}` ||
        (item.path !== '' && pathname.startsWith(`${root}${item.path}/`)),
    ) ?? nav[portal][0]!;

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function signOut() {
    window.location.assign('/api/auth/bhd/logout');
  }

  return (
    <>
      <div className="portal-mobile-bar">
        <button
          type="button"
          className="portal-menu-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          <span aria-hidden="true">{open ? '×' : '☰'}</span>
          <span>{open ? (locale === 'ar' ? 'إغلاق' : 'Close') : t(`Portal.${portal}`)}</span>
        </button>
        <span className="portal-mobile-bar__current">{t(activeItem.label)}</span>
        <Link
          href={`/${portal}`}
          className="portal-mobile-bar__home"
          aria-label={t('Common.dashboard')}
        >
          ⌂
        </Link>
      </div>

      {open ? (
        <button
          type="button"
          className="portal-nav-backdrop"
          aria-label={locale === 'ar' ? 'إغلاق القائمة' : 'Close menu'}
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        id={panelId}
        className={open ? 'portal-sidebar portal-sidebar--open' : 'portal-sidebar'}
      >
        <div className="portal-sidebar__head">
          <Logo descriptor={t(`Portal.${portal}`)} compact />
          <button
            type="button"
            className="portal-sidebar__close"
            onClick={() => setOpen(false)}
            aria-label={locale === 'ar' ? 'إغلاق' : 'Close'}
          >
            ×
          </button>
        </div>
        <p className="portal-sidebar__title">{t(`Portal.${portal}`)}</p>
        <nav className="portal-nav" aria-label={t(`Portal.${portal}`)}>
          {nav[portal].map((item) => {
            const href = `${root}${item.path}`;
            const active =
              pathname === href || (item.path !== '' && pathname.startsWith(`${href}/`));
            return (
              <Link
                key={item.path}
                href={href}
                prefetch
                aria-current={active ? 'page' : undefined}
                onClick={() => setOpen(false)}
              >
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
          <Link
            href={pathname}
            locale={locale === 'ar' ? 'en' : 'ar'}
            onClick={() => setOpen(false)}
          >
            {locale === 'ar' ? 'English' : 'العربية'}
          </Link>
          <button type="button" onClick={() => void signOut()}>
            {t('Common.signOut')}
          </button>
        </div>
      </aside>
    </>
  );
}
