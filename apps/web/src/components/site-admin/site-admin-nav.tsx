'use client';

import Link from 'next/link';
import { pushSoftPortalUrl, useSoftPortalPathname } from '@/lib/soft-portal-nav';
import { siteAdminSoftSectionFromPath } from '@/lib/site-admin-soft-nav';
import {
  SITE_CONSOLE_NAV_GROUPS,
  siteConsoleSectionsFor,
  type SiteAdminAccess,
  type SiteConsoleNavGroup,
} from '@/lib/site-admin-shared';

const GROUP_ORDER = Object.entries(SITE_CONSOLE_NAV_GROUPS)
  .sort((a, b) => a[1].order - b[1].order)
  .map(([id]) => id as SiteConsoleNavGroup);

/** Vertical sidebar — soft-switches sections without remounting the shell. */
export function SiteAdminNav({ access, locale }: { access: SiteAdminAccess; locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const pathname = useSoftPortalPathname() || `/${locale}/admin`;
  const current = siteAdminSoftSectionFromPath(pathname) ?? 'overview';
  const sections = siteConsoleSectionsFor(access);
  const groups = GROUP_ORDER.map((group) => ({
    group,
    label: SITE_CONSOLE_NAV_GROUPS[group],
    items: sections.filter((section) => section.group === group),
  })).filter((entry) => entry.items.length > 0);

  return (
    <aside
      className="site-admin-nav"
      aria-label={ar ? 'تحكم الموقع والنظام' : 'Site & system control'}
    >
      <div className="site-admin-nav__brand">
        <div className="site-admin-nav__mark" aria-hidden="true" />
        <div className="site-admin-nav__brand-copy">
          <p className="site-admin-nav__product">BHD R</p>
          <p className="site-admin-nav__title">{ar ? 'تحكم الموقع' : 'Site control'}</p>
        </div>
        <span className="site-admin-nav__role">
          {access.root
            ? ar
              ? 'مالك الموقع'
              : 'Site owner'
            : ar
              ? 'مدير مفوَّض'
              : 'Delegated manager'}
        </span>
      </div>

      <nav className="site-admin-nav__list">
        {groups.map(({ group, label, items }) => (
          <div key={group} className="site-admin-nav__group">
            {group !== 'home' ? (
              <p className="site-admin-nav__group-label">{ar ? label.ar : label.en}</p>
            ) : null}
            {items.map((section) => {
              const href = `/${locale}${section.path}`;
              const active = section.id === current;
              return (
                <Link
                  key={section.id}
                  href={href}
                  prefetch={false}
                  data-no-progress=""
                  className={active ? 'is-current' : undefined}
                  aria-current={active ? 'page' : undefined}
                  onClick={(event) => {
                    if (
                      !event.defaultPrevented &&
                      event.button === 0 &&
                      !event.metaKey &&
                      !event.ctrlKey &&
                      !event.shiftKey &&
                      !event.altKey &&
                      (!event.currentTarget.target || event.currentTarget.target === '_self')
                    ) {
                      event.preventDefault();
                      pushSoftPortalUrl(event.currentTarget.href);
                    }
                  }}
                >
                  {ar ? section.ar : section.en}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
