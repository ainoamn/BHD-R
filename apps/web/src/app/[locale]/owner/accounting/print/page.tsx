import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { verifySessionToken } from '@bhd-r/authz';
import { AccountingPrintPage } from '@/components/accounting/accounting-print-page';
import { accountingPrintBackHref, type AccountingPrintKind } from '@/lib/accounting-letterhead';
import { loadAccountingPrintDoc } from '@/lib/accounting-letterhead-neon';
import { requireSessionSecret } from '@/lib/runtime-env';
import { privatePortalRobots } from '@/lib/seo';
import { requirePortal } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'مستند محاسبي · Accounting document',
  robots: privatePortalRobots,
};

function kindOf(value: string | string[] | undefined): AccountingPrintKind | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'journal' || raw === 'document' || raw === 'report' ? raw : null;
}

/** Letterheaded print view for journals, documents and reports (same pattern as rent invoices). */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: rawLocale } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  const query = await searchParams;
  const kind = kindOf(query.kind);
  const id = typeof query.id === 'string' ? query.id : Array.isArray(query.id) ? query.id[0] : '';
  const from =
    typeof query.from === 'string' ? query.from : Array.isArray(query.from) ? query.from[0] : null;
  const backHref = accountingPrintBackHref(kind ?? 'document', id || '', from);
  await requirePortal(locale, 'owner');
  const token = (await cookies()).get('bhd_r_session')?.value;
  let doc = null;
  if (kind && id && token) {
    const claims = await verifySessionToken(token, requireSessionSecret()).catch(() => null);
    if (claims) {
      doc = await loadAccountingPrintDoc(claims, {
        kind,
        id,
        locale,
        ...(typeof query.report === 'string' ? { report: query.report } : {}),
        ...(typeof query.fromDate === 'string' ? { fromDate: query.fromDate } : {}),
        ...(typeof query.toDate === 'string' ? { toDate: query.toDate } : {}),
      }).catch((error: unknown) => {
        console.error('accounting print failed', error);
        return null;
      });
    }
  }
  return <AccountingPrintPage doc={doc} locale={locale} backHref={backHref} />;
}
