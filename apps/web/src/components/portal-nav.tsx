'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { PortalHeader } from '@/components/portal-header';
import { warmOpsSection } from '@/lib/portal-ops-client-cache';
import { isOperationsSection, type OperationsSection } from '@/lib/portal-ops-types';
import type { PortalRole, Viewer } from '@/lib/types';

type NavItem = { path: string; label: string; mark: string };
type NavGroup = { id: string; label: string; items: NavItem[] };

const navGroups: Record<PortalRole, NavGroup[]> = {
  platform: [
    {
      id: 'core',
      label: 'Portal.groupCore',
      items: [
        { path: '', label: 'Common.dashboard', mark: '⌂' },
        { path: '/organizations', label: 'Common.organizations', mark: '◫' },
        { path: '/users', label: 'Common.users', mark: '◎' },
      ],
    },
    {
      id: 'insight',
      label: 'Portal.groupInsight',
      items: [
        { path: '/audit', label: 'Common.audit', mark: '≡' },
        { path: '/reports', label: 'Common.reports', mark: '↗' },
        { path: '/settings', label: 'Common.settings', mark: '⚙' },
      ],
    },
  ],
  owner: [
    {
      id: 'core',
      label: 'Portal.groupCore',
      items: [
        { path: '', label: 'Common.dashboard', mark: '⌂' },
        { path: '/properties', label: 'Common.properties', mark: '▤' },
        { path: '/contacts', label: 'Common.contacts', mark: '◎' },
      ],
    },
    {
      id: 'pipeline',
      label: 'Portal.groupPipeline',
      items: [
        { path: '/requests', label: 'Common.requests', mark: '◌' },
        { path: '/bookings', label: 'Common.bookings', mark: '⌁' },
        { path: '/leasing', label: 'Common.leasing', mark: '⌂' },
        { path: '/sales', label: 'Common.sales', mark: '◆' },
        { path: '/contracts', label: 'Common.contracts', mark: '✎' },
      ],
    },
    {
      id: 'finance',
      label: 'Portal.groupFinance',
      items: [
        { path: '/invoices', label: 'Common.invoices', mark: '▧' },
        { path: '/payments', label: 'Common.payments', mark: '◇' },
        { path: '/accounting', label: 'Common.accounting', mark: '∑' },
        { path: '/expenses', label: 'Common.expenses', mark: '↘' },
      ],
    },
    {
      id: 'ops',
      label: 'Portal.groupOps',
      items: [
        { path: '/maintenance', label: 'Common.maintenance', mark: '◉' },
        { path: '/work-orders', label: 'Common.workOrders', mark: '⚒' },
        { path: '/tasks', label: 'Common.tasks', mark: '✓' },
        { path: '/legal', label: 'Common.legalCases', mark: '§' },
        { path: '/approvals', label: 'Common.approvals', mark: '◎' },
      ],
    },
    {
      id: 'org',
      label: 'Portal.groupOrg',
      items: [
        { path: '/reports', label: 'Common.reports', mark: '↗' },
        { path: '/team', label: 'Common.team', mark: '◎' },
        { path: '/api-keys', label: 'Common.apiKeys', mark: '⌘' },
      ],
    },
  ],
  developer: [
    {
      id: 'core',
      label: 'Portal.groupCore',
      items: [
        { path: '', label: 'Common.dashboard', mark: '⌂' },
        { path: '/properties', label: 'Common.properties', mark: '▤' },
        { path: '/contacts', label: 'Common.contacts', mark: '◎' },
      ],
    },
    {
      id: 'pipeline',
      label: 'Portal.groupPipeline',
      items: [
        { path: '/requests', label: 'Common.requests', mark: '◌' },
        { path: '/bookings', label: 'Common.bookings', mark: '⌁' },
        { path: '/leasing', label: 'Common.leasing', mark: '⌂' },
        { path: '/sales', label: 'Common.sales', mark: '◆' },
        { path: '/contracts', label: 'Common.contracts', mark: '✎' },
      ],
    },
    {
      id: 'finance',
      label: 'Portal.groupFinance',
      items: [
        { path: '/invoices', label: 'Common.invoices', mark: '▧' },
        { path: '/payments', label: 'Common.payments', mark: '◇' },
        { path: '/accounting', label: 'Common.accounting', mark: '∑' },
        { path: '/expenses', label: 'Common.expenses', mark: '↘' },
      ],
    },
    {
      id: 'ops',
      label: 'Portal.groupOps',
      items: [
        { path: '/maintenance', label: 'Common.maintenance', mark: '◉' },
        { path: '/work-orders', label: 'Common.workOrders', mark: '⚒' },
        { path: '/tasks', label: 'Common.tasks', mark: '✓' },
        { path: '/legal', label: 'Common.legalCases', mark: '§' },
        { path: '/approvals', label: 'Common.approvals', mark: '◎' },
      ],
    },
    {
      id: 'org',
      label: 'Portal.groupOrg',
      items: [
        { path: '/reports', label: 'Common.reports', mark: '↗' },
        { path: '/team', label: 'Common.team', mark: '◎' },
        { path: '/api-keys', label: 'Common.apiKeys', mark: '⌘' },
      ],
    },
  ],
  tenant: [
    {
      id: 'core',
      label: 'Portal.groupCore',
      items: [
        { path: '', label: 'Common.dashboard', mark: '⌂' },
        { path: '/reservations', label: 'Common.bookings', mark: '⌁' },
        { path: '/contracts', label: 'Common.contracts', mark: '✎' },
        { path: '/leases', label: 'Common.leasing', mark: '⌂' },
      ],
    },
    {
      id: 'finance',
      label: 'Portal.groupFinance',
      items: [
        { path: '/invoices', label: 'Common.invoices', mark: '▧' },
        { path: '/payments', label: 'Common.payments', mark: '◇' },
      ],
    },
    {
      id: 'ops',
      label: 'Portal.groupOps',
      items: [
        { path: '/maintenance', label: 'Common.maintenance', mark: '◉' },
        { path: '/requests', label: 'Common.requests', mark: '◌' },
      ],
    },
  ],
};

function PortalIntentLink({
  portal,
  href,
  section,
  active,
  mark,
  onNavigate,
  children,
}: {
  portal: PortalRole;
  href: string;
  section: OperationsSection | null;
  active: boolean;
  mark: string;
  onNavigate: () => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const warmed = useRef(false);

  const warmDestination = () => {
    if (warmed.current || active) return;
    warmed.current = true;
    setArmed(true);
    // Intent-based prefetch keeps the sidebar light while making the route the
    // user is actually approaching available before the click.
    try {
      router.prefetch(href);
    } catch {
      /* route prefetch is best-effort */
    }
    if (section) void warmOpsSection(portal, section);
  };

  return (
    <Link
      href={href}
      prefetch={armed ? null : false}
      scroll={false}
      aria-current={active ? 'page' : undefined}
      onMouseEnter={warmDestination}
      onFocus={warmDestination}
      onTouchStart={warmDestination}
      onClick={onNavigate}
    >
      <span className="portal-nav__mark" aria-hidden="true">
        {mark}
      </span>
      {children}
    </Link>
  );
}

export function PortalNav({ portal, viewer }: { portal: PortalRole; viewer: Viewer }) {
  const t = useTranslations();
  const pathname = usePathname();
  const locale = useLocale() as 'ar' | 'en';
  const [open, setOpen] = useState(false);
  const [isDrawerViewport, setIsDrawerViewport] = useState(false);
  const panelId = useId();
  const root = `/${portal}`;

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 960px)');
    const sync = () => {
      const matches = media.matches;
      setIsDrawerViewport(matches);
      if (!matches) setOpen(false);
    };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!open || !isDrawerViewport) return;
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
  }, [open, isDrawerViewport]);

  const drawerHidden = isDrawerViewport && !open;

  return (
    <>
      <PortalHeader
        portal={portal}
        viewer={viewer}
        onOpenNav={() => setOpen((value) => !value)}
        navOpen={open}
        navPanelId={panelId}
      />

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
        aria-hidden={drawerHidden || undefined}
        {...(drawerHidden ? { inert: true } : {})}
      >
        <div className="portal-sidebar__head">
          <p className="portal-sidebar__title">{t(`Portal.${portal}`)}</p>
          <button
            type="button"
            className="portal-sidebar__close"
            onClick={() => setOpen(false)}
            aria-label={locale === 'ar' ? 'إغلاق' : 'Close'}
          >
            ×
          </button>
        </div>
        <nav className="portal-nav" aria-label={t(`Portal.${portal}`)}>
          {navGroups[portal].map((group) => (
            <div key={group.id} className="portal-nav__group">
              <p className="portal-nav__group-label">{t(group.label)}</p>
              {group.items.map((item) => {
                const href = `${root}${item.path}`;
                const active =
                  pathname === href || (item.path !== '' && pathname.startsWith(`${href}/`));
                const sectionName = item.path.replace(/^\//, '');
                const section = isOperationsSection(sectionName) ? sectionName : null;
                return (
                  <PortalIntentLink
                    key={item.path || 'root'}
                    portal={portal}
                    href={href}
                    section={section}
                    active={active}
                    mark={item.mark}
                    onNavigate={() => setOpen(false)}
                  >
                    {t(item.label)}
                  </PortalIntentLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="portal-sidebar__foot">
          <a href="https://id.bhd-om.com/account" className="portal-sidebar__account">
            {locale === 'ar' ? 'إدارة حساب BHD' : 'Manage BHD account'}
          </a>
          <a href="https://www.bhd-om.com" className="portal-sidebar__account">
            {locale === 'ar' ? 'بوابة BHD الرئيسية' : 'BHD main portal'}
          </a>
        </div>
      </aside>
    </>
  );
}
