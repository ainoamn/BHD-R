import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { ContractArticle, type ContractArticleLinks } from '@/components/contract-document-view';
import { ContractDocumentToolbar } from '@/components/contract-document-toolbar';
import { StayEsignWizard } from '@/components/stays/stay-esign-wizard';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { formatMoney } from '@/lib/format';
import { leaseBookingAgreement, leaseContractTitle } from '@/lib/lease-booking-contract';
import { leaseConfirmedPath, leaseSignPath } from '@/lib/lease-booking-paths';
import { leasePaymentPath, loadLeaseBookingAgreement } from '@/lib/public-lease-booking-neon';
import { getViewer } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign contract | توقيع العقد',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

const AGREEMENT_ID = 'reservation-agreement';

export default async function LeaseBookingSignPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const ar = locale === 'ar';
  const query = await searchParams;
  const refRaw = query.ref;
  const referenceCode =
    typeof refRaw === 'string' ? refRaw : Array.isArray(refRaw) ? refRaw[0] : undefined;
  if (!referenceCode || !hasDatabaseUrl()) notFound();

  const viewer = await getViewer();
  if (!viewer) {
    redirect(`/${locale}/login?next=${encodeURIComponent(leaseSignPath(locale, referenceCode))}`);
  }

  const booking = await loadLeaseBookingAgreement(viewer.id, referenceCode).catch(() => null);
  if (!booking) notFound();
  if (!booking.depositPaidAt) {
    if (booking.status === 'pending') {
      redirect(leasePaymentPath(locale, booking.sessionReference, booking.referenceCode));
    }
    notFound();
  }

  const { head, doc } = leaseBookingAgreement(booking);
  const title = leaseContractTitle(booking.mode);
  const signature = booking.signature;
  const links: ContractArticleLinks = {
    file: () => signature?.png ?? '',
    contract: () => leaseSignPath(locale, booking.referenceCode),
    annex: () => leaseSignPath(locale, booking.referenceCode),
  };
  const property = ar ? booking.propertyNameAr : booking.propertyNameEn;
  const unit = ar ? booking.unitNameAr : booking.unitNameEn;
  const deposit = formatMoney(booking.depositMinor, booking.currency, locale);

  const article = (
    <ContractArticle id={AGREEMENT_ID} contract={head} doc={doc} locale={locale} links={links} />
  );

  return (
    <main className="stay-esign-shell">
      <StayEsignWizard
        locale={locale}
        referenceCode={booking.referenceCode}
        contractDocument={
          signature ? (
            <>
              <ContractDocumentToolbar
                ar={ar}
                documentId={AGREEMENT_ID}
                title={ar ? title.ar : title.en}
                reference={booking.referenceCode}
                summary={`${booking.contact.fullName} · ${property} (${unit}) · ${deposit}`}
                recipient={null}
                recipientPath={null}
                pdfUrl={null}
                printOnly
              />
              {article}
            </>
          ) : (
            article
          )
        }
        signatureSerial={signature?.serial ?? null}
        initiallyComplete={Boolean(signature)}
        submitUrl={`/api/public/bookings/deposits/${encodeURIComponent(booking.referenceCode)}/esign`}
        continuePath={leaseConfirmedPath(locale, booking.referenceCode)}
        contractTitle={title}
        requireCsrf
      />
    </main>
  );
}
