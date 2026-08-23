import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Card, CardContent, StatusBadge } from '@bhd-r/ui';
import type { PublicInvoice } from '@bhd-r/contracts';
import { ApiError, publicApiFetch } from '@/lib/server-api';
import { formatMoney } from '@/lib/format';
import { PayInvoiceButton } from '@/components/pay-invoice-button';

export const metadata: Metadata = {
  title: 'فاتورة | Invoice',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
  openGraph: { images: [] },
  twitter: { images: [] },
};

async function loadInvoice(token: string): Promise<PublicInvoice | null> {
  try {
    return await publicApiFetch<PublicInvoice>(
      `/v1/public/invoices/${encodeURIComponent(token)}`,
      0,
    );
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 410)) return null;
    throw error;
  }
}

export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ locale: string; publicToken: string }>;
}) {
  const { locale, publicToken } = await params;
  const invoice = await loadInvoice(publicToken);
  if (!invoice) notFound();
  const ar = locale === 'ar';
  return (
    <section className="auth-shell">
      <Card className="auth-card">
        <CardContent>
          <span className="eyebrow">BHD R</span>
          <h1>{ar ? 'فاتورة مستحقة' : 'Invoice due'}</h1>
          <StatusBadge
            status={
              invoice.status === 'paid'
                ? 'positive'
                : invoice.status === 'overdue' || invoice.status === 'void'
                  ? 'negative'
                  : invoice.status === 'partially_paid'
                    ? 'warning'
                    : 'neutral'
            }
            label={invoice.status}
          />
          <dl className="detail-facts">
            <div>
              <dt>{ar ? 'الجهة' : 'Issuer'}</dt>
              <dd>{invoice.merchantName}</dd>
            </div>
            <div>
              <dt>{ar ? 'المرجع' : 'Reference'}</dt>
              <dd>{invoice.publicReference}</dd>
            </div>
            <div>
              <dt>{ar ? 'الاستحقاق' : 'Due date'}</dt>
              <dd>{invoice.dueOn}</dd>
            </div>
          </dl>
          <h2>
            {formatMoney(invoice.outstanding.amountMinor, invoice.outstanding.currency, locale)}
          </h2>
          {invoice.paymentEnabled ? <PayInvoiceButton publicToken={publicToken} /> : null}
          <p className="muted">
            {ar
              ? 'لا تعرض هذه الصفحة اسم المستأجر أو عنوانه أو بنود العقد أو المستندات.'
              : 'This page does not expose tenant identity, address, lease terms or documents.'}
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
