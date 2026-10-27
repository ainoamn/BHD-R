import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { LeasingOpsReportView } from '@/components/leasing-ops-report-view';
import {
  leasingReportPresentation,
  loadLeasingOpsReport,
} from '@/lib/leasing-report-neon';
import { privatePortalRobots } from '@/lib/seo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: 'تقرير التأجير · Leasing report',
  robots: privatePortalRobots,
};

/** Formal sealed leasing report for print / Save as PDF and Excel download. */
export default async function OwnerLeasingReportPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale: rawLocale, token } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const snapshot = await loadLeasingOpsReport(token);
  if (!snapshot) notFound();
  const { verifyUrl, qrSvg } = await leasingReportPresentation(snapshot);
  return (
    <main className="page-shell">
      <LeasingOpsReportView
        locale={locale}
        snapshot={snapshot}
        verifyUrl={verifyUrl}
        qrSvg={qrSvg}
        mode="owner"
      />
    </main>
  );
}
