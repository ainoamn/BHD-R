import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LeasingOpsReportView } from '@/components/leasing-ops-report-view';
import { leasingReportPresentation, loadLeasingOpsReport } from '@/lib/leasing-report-neon';
import { privatePortalRobots } from '@/lib/seo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: 'التحقق من تقرير التأجير · Leasing report verification',
  robots: privatePortalRobots,
};

/** Public page opened from the QR printed / shown on a leasing ops report. */
export default async function VerifyLeasingReportPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale: rawLocale, token } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const snapshot = await loadLeasingOpsReport(token).catch(() => null);
  if (!snapshot) {
    return (
      <main className="page-shell">
        <div className="notice notice--error" role="alert">
          {locale === 'ar'
            ? 'تعذّر التحقق من هذا التقرير أو أنه غير موجود.'
            : 'This report could not be verified or was not found.'}
        </div>
      </main>
    );
  }
  const { verifyUrl, qrSvg } = await leasingReportPresentation(snapshot);
  return (
    <main className="page-shell">
      <LeasingOpsReportView
        locale={locale}
        snapshot={snapshot}
        verifyUrl={verifyUrl}
        qrSvg={qrSvg}
        mode="verify"
      />
    </main>
  );
}
