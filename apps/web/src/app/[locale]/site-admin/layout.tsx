import type { Metadata } from 'next';
import { privatePortalRobots } from '@/lib/seo';

export const metadata: Metadata = {
  robots: privatePortalRobots,
  title: {
    default: 'تحكم الموقع والنظام',
    template: '%s · تحكم الموقع',
  },
};

/**
 * Dedicated chrome for site owners / managers only.
 * Never wraps owner, tenant, or thin product portals.
 */
export default function SiteAdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="site-admin-shell">{children}</div>;
}
