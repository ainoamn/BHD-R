import type { Metadata } from 'next';
import { RentDocumentPage } from '@/components/rent-document-page';
import { rentDocKindOf } from '@/lib/rent-documents';
import { loadRentDocument } from '@/lib/rent-documents-neon';
import { privatePortalRobots } from '@/lib/seo';
import { requirePortal } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'إيصال أو فاتورة · Receipt or invoice',
  robots: privatePortalRobots,
};

/** The tenant's signed receipt (what they paid) or demand invoice (what is due) for one item. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; leaseId: string; line: string }>;
  searchParams: Promise<{ doc?: string | string[] }>;
}) {
  const { locale: rawLocale, leaseId, line } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  const viewer = await requirePortal(locale, 'tenant');
  const kind = rentDocKindOf((await searchParams).doc) ?? 'invoice';
  const doc = await loadRentDocument(
    { type: 'tenant', userId: viewer.id },
    leaseId,
    decodeURIComponent(line),
    kind,
  ).catch((error: unknown) => {
    console.error('tenant rent document failed', error);
    return null;
  });
  return <RentDocumentPage doc={doc} locale={locale} portal="tenant" backHref="/tenant/invoices" />;
}
