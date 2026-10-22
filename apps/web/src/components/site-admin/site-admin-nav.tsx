'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  SITE_CONSOLE_SECTIONS,
  siteConsoleSectionsFor,
  type SiteAdminAccess,
  type SiteConsoleSectionId,
} from '@/lib/site-admin-shared';

function sectionFromPath(pathname: string): SiteConsoleSectionId {
  const bare = pathname.replace(/^\/(ar|en)/, '') || '/admin';
  const match = SITE_CONSOLE_SECTIONS.filter((section) => section.path !== '/admin')
    .sort((a, b) => b.path.length - a.path.length)
    .find((section) => bare === section.path || bare.startsWith(`${section.path}/`));
  return match?.id ?? 'overview';
}

/** Vertical sidebar for the site console — never mixed with owner/tenant portals. */
export function SiteAdminNav({
  access,
  locale,
}: {
  access: SiteAdminAccess;
  locale: 'ar' | 'en';
}) {
  const ar = locale === 'ar';
  const pathname = usePathname() || `/${locale}/admin`;
  const current = sectionFromPath(pathname);
  const sections = siteConsoleSectionsFor(access);

  return (
    <aside className="site-admin-nav" aria-label={ar ? 'تحكم الموقع والنظام' : 'Site & system control'}>
      <div className="site-admin-nav__brand">
        <p className="site-admin-nav__title">{ar ? 'تحكم الموقع' : 'Site control'}</p>
        <span className="site-admin-nav__role">
          {access.root ? (ar ? 'مالك الموقع' : 'Site owner') : ar ? 'مدير مفوَّض' : 'Delegated manager'}
        </span>
      </div>
      <nav className="site-admin-nav__list">
        {sections.map((section) => (
          <Link
            key={section.id}
            href={`/${locale}${section.path}`}
            prefetch={false}
            className={section.id === current ? 'is-current' : undefined}
            aria-current={section.id === current ? 'page' : undefined}
          >
            {ar ? section.ar : section.en}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
