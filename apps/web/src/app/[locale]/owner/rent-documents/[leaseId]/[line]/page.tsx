import type { Metadata } from 'next';
import { RentDocumentPage } from '@/components/rent-document-page';
import { readClaims } from '@/lib/portal-ops-data';
import { rentDocKindOf } from '@/lib/rent-documents';
import { loadRentDocument } from '@/lib/rent-documents-neon';
import { privatePortalRobots } from '@/lib/seo';
import { requirePortal } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'إيصال أو فاتورة · Receipt or invoice',
  robots: privatePortalRobots,
};

/** The same signed documents the tenant gets, for staff who collect rent on the lease. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; leaseId: string; line: string }>;
  searchParams: Promise<{ doc?: string | string[] }>;
}) {
  const { locale: rawLocale, leaseId, line } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  await requirePortal(locale, 'owner');
  const claims = await readClaims();
  const kind = rentDocKindOf((await searchParams).doc) ?? 'invoice';
  const doc = claims
    ? await loadRentDocument(
        { type: 'staff', claims },
        leaseId,
        decodeURIComponent(line),
        kind,
      ).catch((error: unknown) => {
        console.error('owner rent document failed', error);
        return null;
      })
    : null;
  return (
    <RentDocumentPage
      doc={doc}
      locale={locale}
      portal="owner"
      backHref={`/owner/tenant-requests?tab=rent&lease=${leaseId}`}
    />
  );
}
