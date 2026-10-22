import 'server-only';
import { notFound } from 'next/navigation';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { isSitePageEnabled, readMaintenancePublic } from '@/lib/site-control-neon';
import type { SitePageId } from '@/lib/site-control-shared';

/**
 * Call from a public page server component to honour site-page toggles
 * and hard maintenance (admin/login remain reachable separately).
 */
export async function assertPublicSitePage(pageId: SitePageId): Promise<void> {
  if (!hasDatabaseUrl()) return;
  try {
    const maintenance = await readMaintenancePublic();
    if (maintenance.enabled && maintenance.mode === 'hard') notFound();
    if (!(await isSitePageEnabled(pageId))) notFound();
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    // DB blip — keep the page available rather than blanking the site.
  }
}
