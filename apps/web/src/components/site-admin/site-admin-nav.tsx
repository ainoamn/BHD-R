import Link from 'next/link';
import {
  ADMIN_SECTIONS,
  SCOPE_LABELS,
  type AdminScope,
  type SiteAdminAccess,
} from '@/lib/site-admin-shared';

/** Sections of site administration this account may open, as a scrollable tab row. */
export function SiteAdminNav({
  access,
  current,
  locale,
}: {
  access: SiteAdminAccess;
  current: AdminScope;
  locale: 'ar' | 'en';
}) {
  const ar = locale === 'ar';
  return (
    <nav className="site-admin-nav" aria-label={ar ? 'أقسام إدارة الموقع' : 'Site admin sections'}>
      <span className="site-admin-nav__role">
        {access.root ? (ar ? 'إدارة عليا' : 'Top-level admin') : ar ? 'مفوَّض' : 'Delegate'}
      </span>
      <div className="site-admin-nav__tabs">
        {ADMIN_SECTIONS.filter((section) => access.scopes.includes(section.scope)).map(
          (section) => (
            <Link
              key={section.scope}
              href={`/${locale}${section.path}`}
              prefetch={false}
              className={section.scope === current ? 'is-current' : undefined}
              aria-current={section.scope === current ? 'page' : undefined}
            >
              {ar ? SCOPE_LABELS[section.scope].ar : SCOPE_LABELS[section.scope].en}
            </Link>
          ),
        )}
      </div>
    </nav>
  );
}
