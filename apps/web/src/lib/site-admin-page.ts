import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readClaims } from '@/lib/portal-ops-data';
import { siteAdminAccess } from '@/lib/site-admin-neon';
import {
  ADMIN_SECTIONS,
  SITE_CONSOLE_SECTIONS,
  type AdminScope,
  type SiteAdminAccess,
} from '@/lib/site-admin-shared';

/**
 * Gate for a site-console page. Accounts without any admin scope get a 404; a delegate who lacks
 * this section's scope lands on the first section they do hold.
 */
export async function requireSiteAdminPage(
  locale: 'ar' | 'en',
  scope: AdminScope | null,
  options?: { path?: string },
): Promise<SiteAdminAccess> {
  if (!hasDatabaseUrl()) notFound();
  const path =
    options?.path ??
    (scope
      ? ADMIN_SECTIONS.find((section) => section.scope === scope)!.path
      : '/site-admin');
  const claims = await readClaims();
  if (!claims) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}${path}`)}`);
  const access = await siteAdminAccess(claims).catch(() => null);
  if (!access) notFound();
  if (scope && !access.scopes.includes(scope)) {
    const first =
      SITE_CONSOLE_SECTIONS.find(
        (section) => section.scope === null || access.scopes.includes(section.scope),
      ) ?? ADMIN_SECTIONS.find((section) => access.scopes.includes(section.scope));
    if (!first) notFound();
    redirect(`/${locale}${first.path}`);
  }
  return access;
}
