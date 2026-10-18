import { notFound } from 'next/navigation';
import { WorkTaskWorkspace } from '@/components/work-task-workspace';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { readClaims } from '@/lib/portal-ops-data';
import { requirePortal } from '@/lib/viewer';
import { readWorkTask } from '@/lib/work-task-neon';

async function Page({ params }: { params: Promise<{ locale: string; taskId: string }> }) {
  const { locale: rawLocale, taskId } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  await requirePortal(locale, 'owner');
  if (!hasDatabaseUrl() || !/^[0-9a-f-]{36}$/i.test(taskId)) notFound();
  const claims = await readClaims();
  const detail = claims ? await readWorkTask(claims, taskId).catch(() => null) : null;
  if (!detail) notFound();
  return <WorkTaskWorkspace initial={detail} locale={locale} portal="owner" />;
}

export default persistentPortalPage('/owner/tasks/[taskId]', Page);
