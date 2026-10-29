import { SITE_CONSOLE_SECTIONS, type SiteConsoleSectionId } from '@/lib/site-admin-shared';

/** Soft-switchable console sections (kept mounted after first visit). */
export const SITE_ADMIN_SOFT_SECTION_IDS = SITE_CONSOLE_SECTIONS.map(
  (section) => section.id,
);

export function siteAdminSoftSectionFromPath(pathname: string): SiteConsoleSectionId | null {
  const bare =
    (pathname.replace(/^\/(ar|en)(?=\/|$)/, '') || '/admin').replace(/\/$/, '') || '/admin';
  if (bare === '/admin') return 'overview';

  const match = SITE_CONSOLE_SECTIONS.filter((section) => section.path !== '/admin')
    .sort((a, b) => b.path.length - a.path.length)
    .find((section) => bare === section.path || bare.startsWith(`${section.path}/`));

  if (!match) return null;

  // Nested detail routes (e.g. /admin/badges/awards/:id) stay on the Next outlet.
  if (bare !== match.path && bare.startsWith(`${match.path}/`)) {
    return null;
  }
  return match.id;
}

export function siteAdminPathForSection(id: SiteConsoleSectionId): string {
  return SITE_CONSOLE_SECTIONS.find((section) => section.id === id)?.path ?? '/admin';
}
