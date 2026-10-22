import Link from 'next/link';
import {
  siteConsoleSectionsFor,
  type SiteAdminAccess,
  type SiteConsoleSectionId,
} from '@/lib/site-admin-shared';

/** Sections of site administration — system console only, never mixed with owner/tenant portals. */
export function SiteAdminNav({
  access,
  current,
  locale,
}: {
  access: SiteAdminAccess;
  current: SiteConsoleSectionId;
  locale: 'ar' | 'en';
}) {
  const ar = locale === 'ar';
  const sections = siteConsoleSectionsFor(access);
  return (
    <nav className="site-admin-nav" aria-label={ar ? 'تحكم الموقع والنظام' : 'Site & system control'}>
      <span className="site-admin-nav__role">
        {access.root ? (ar ? 'مالك الموقع' : 'Site owner') : ar ? 'مدير مفوَّض' : 'Delegated manager'}
      </span>
      <div className="site-admin-nav__tabs">
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
      </div>
    </nav>
  );
}
