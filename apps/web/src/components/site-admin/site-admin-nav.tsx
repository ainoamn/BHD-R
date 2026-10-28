'use client';

import Link from 'next/link';
import { pushSoftPortalUrl, useSoftPortalPathname } from '@/lib/soft-portal-nav';
import { siteAdminSoftSectionFromPath } from '@/lib/site-admin-soft-nav';
import { siteConsoleSectionsFor, type SiteAdminAccess } from '@/lib/site-admin-shared';

/** Vertical sidebar — soft-switches sections without remounting the shell. */
export function SiteAdminNav({ access, locale }: { access: SiteAdminAccess; locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const pathname = useSoftPortalPathname() || `/${locale}/admin`;
  const current = siteAdminSoftSectionFromPath(pathname) ?? 'overview';
  const sections = siteConsoleSectionsFor(access);

  return (
    <aside
      className="site-admin-nav"
      aria-label={ar ? 'تحكم الموقع والنظام' : 'Site & system control'}
    >
      <div className="site-admin-nav__brand">
        <p className="site-admin-nav__title">{ar ? 'تحكم الموقع' : 'Site control'}</p>
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
        {sections.map((section) => {
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
      </nav>
    </aside>
  );
}
