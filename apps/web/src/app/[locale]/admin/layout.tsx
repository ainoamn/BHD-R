import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { SiteAdminChrome } from '@/components/site-admin/site-admin-chrome';
import { SiteAdminUnavailable } from '@/components/site-admin/site-admin-unavailable';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readClaims } from '@/lib/portal-ops-data';
import { privatePortalRobots } from '@/lib/seo';
import { siteAdminAccess } from '@/lib/site-admin-neon';
import type { Viewer } from '@/lib/types';
import { getShellViewer } from '@/lib/viewer';
import '../../site-admin.css';
import '../../portal-adaptive.css';
import '../../badges-verification.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: privatePortalRobots,
  title: {
    default: 'تحكم الموقع والنظام',
    template: '%s · تحكم الموقع',
  },
};

/**
 * Dedicated chrome for site owners / managers only.
 * Sidebar lives here so every console page shares one navigation.
 *
 * Access denial is rendered here (not via notFound()) because a layout-level
 * notFound() bubbles to the root catalogue 404 and skips admin/not-found.tsx.
 */
export default async function SiteAdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  if (!hasDatabaseUrl()) return <SiteAdminUnavailable locale={locale} />;
  const claims = await readClaims();
  if (!claims) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/admin`)}`);
  let access;
  try {
    access = await siteAdminAccess(claims);
  } catch (error) {
    console.error('SiteAdminLayout: siteAdminAccess failed', error);
    throw error;
  }
  if (!access) return <SiteAdminUnavailable locale={locale} />;
  const shell = await getShellViewer();
  const viewer: Viewer = shell ?? {
    id: claims.sub,
    displayName: claims.locale === 'ar' ? 'مستخدم BHD' : 'BHD user',
    partyId: claims.partyId,
    locale,
    organizationId: claims.organizationId,
    roles: claims.roles,
    permissions: claims.permissions,
    portals: ['owner', 'tenant'],
  };
  return (
    <div className="site-admin-shell">
      <SiteAdminChrome access={access} locale={locale} viewer={viewer}>
        {children}
      </SiteAdminChrome>
    </div>
  );
}
