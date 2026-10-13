import { notFound } from 'next/navigation';
import { LegalCaseWorkspace } from '@/components/legal-case-workspace';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readLegalCase } from '@/lib/legal-case-neon';
import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { readClaims } from '@/lib/portal-ops-data';
import { requirePortal } from '@/lib/viewer';

async function Page({ params }: { params: Promise<{ locale: string; caseId: string }> }) {
  const { locale: rawLocale, caseId } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  await requirePortal(locale, 'owner');
  if (!hasDatabaseUrl() || !/^[0-9a-f-]{36}$/i.test(caseId)) notFound();
  const claims = await readClaims();
  const detail = claims ? await readLegalCase(claims, caseId).catch(() => null) : null;
  if (!detail) notFound();
  return <LegalCaseWorkspace initial={detail} locale={locale} portal="owner" />;
}

export default persistentPortalPage('/owner/legal/[caseId]', Page);
