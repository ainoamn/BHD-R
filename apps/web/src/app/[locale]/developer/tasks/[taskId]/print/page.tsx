import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { WorkTaskPrintPage } from '@/components/work-task-print-page';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readClaims } from '@/lib/portal-ops-data';
import { privatePortalRobots } from '@/lib/seo';
import { requirePortal } from '@/lib/viewer';
import { workTaskOpenUrl, workTaskQrSvg } from '@/lib/work-task-print';
import { readWorkTask } from '@/lib/work-task-neon';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'طباعة مهمة · Print task',
  robots: privatePortalRobots,
};

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; taskId: string }>;
}) {
  const { locale: rawLocale, taskId } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  await requirePortal(locale, 'developer');
  if (!hasDatabaseUrl() || !/^[0-9a-f-]{36}$/i.test(taskId)) notFound();
  const claims = await readClaims();
  const detail = claims ? await readWorkTask(claims, taskId).catch(() => null) : null;
  if (!detail) notFound();
  const openUrl = workTaskOpenUrl(locale, 'developer', detail.id);
  const qrSvg = await workTaskQrSvg(openUrl);
  return (
    <WorkTaskPrintPage
      detail={detail}
      locale={locale}
      portal="developer"
      qrSvg={qrSvg}
      openUrl={openUrl}
    />
  );
}
