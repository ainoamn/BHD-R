import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { LeaseBookingReceipt } from '@/components/lease-booking-receipt';
import { StayReceiptPrintButton } from '@/components/stays/stay-receipt-print-button';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { localizedName } from '@/lib/format';
import { leaseConfirmedPath, leaseReceiptPath } from '@/lib/lease-booking-paths';
import { readClaims } from '@/lib/portal-ops-data';
import {
  leaseReservationIdForStaff,
  loadLeaseBookingForStaff,
  loadLeaseBookingForViewer,
} from '@/lib/public-lease-booking-neon';
import { partyDisplayName } from '@/lib/reservation-party';
import { loadStayReceiptLetterhead } from '@/lib/stay-receipt-letterhead-neon';
import { getViewer } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Booking deposit receipt | إيصال عربون الحجز',
  robots: { index: false, follow: false, nocache: true },
};

export default async function LeaseBookingReceiptPage({
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
  const ref = typeof refRaw === 'string' ? refRaw : Array.isArray(refRaw) ? refRaw[0] : undefined;
  if (!ref || !hasDatabaseUrl()) notFound();

  const viewer = await getViewer();
  if (!viewer) {
    redirect(`/${locale}/login?next=${encodeURIComponent(leaseReceiptPath(locale, ref))}`);
  }

  const own = await loadLeaseBookingForViewer(viewer.id, ref).catch(() => null);
  const claims = own ? null : await readClaims();
  const reservationId =
    !own && claims ? await leaseReservationIdForStaff(claims, ref).catch(() => null) : null;
  const staff =
    !own && reservationId && claims
      ? await loadLeaseBookingForStaff(claims, reservationId).catch(() => null)
      : null;
  const source = own ?? staff;
  if (!source?.depositPaidAt) notFound();

  const propertyName = localizedName(locale, source.propertyNameAr, source.propertyNameEn);
  const unitName = localizedName(locale, source.unitNameAr, source.unitNameEn);
  const forOther = source.bookingFor === 'other';
  const partyName =
    (source.party ? partyDisplayName(source.party, ar) : null) ||
    (forOther ? source.bookedByName : source.contact.fullName) ||
    source.contact.fullName ||
    '—';

  const letterhead = source.organizationId
    ? await loadStayReceiptLetterhead({
        organizationId: source.organizationId,
        referenceCode: source.referenceCode,
        docKind: 'payment',
        amountMinor: source.depositMinor,
        locale,
        verifyPath: leaseReceiptPath(locale, source.referenceCode),
      })
    : null;

  return (
    <div className="dash-shell rent-doc-page stays-booking-receipt">
      <div className="rent-doc-page__actions">
        <StayReceiptPrintButton
          locale={locale}
          label={ar ? '⬇ تحميل / طباعة PDF' : '⬇ Download / print PDF'}
        />
        <a className="button button--quiet" href={leaseConfirmedPath(locale, source.referenceCode)}>
          {ar ? 'العودة للحجز' : 'Back to booking'}
        </a>
      </div>
      <p className="rent-doc__hint muted">
        {ar
          ? 'إيصال العربون المعتمد — نفس المستند في ملف العميل. لحفظه كـ PDF اختر «حفظ كـ PDF» في نافذة الطباعة.'
          : 'Official booking-deposit receipt — the same document in the client file. To save a PDF, choose “Save as PDF” in the print dialog.'}
      </p>
      <LeaseBookingReceipt
        locale={locale}
        issuer={letterhead?.issuer ?? null}
        signature={letterhead?.signature ?? null}
        booking={{
          referenceCode: source.referenceCode,
          mode: source.mode,
          depositMinor: source.depositMinor,
          currency: source.currency,
          depositPaidAt: source.depositPaidAt,
          cardLast4: source.cardLast4,
          partyName,
          partyEmail: source.contact.email,
          propertyName,
          unitLabel: [source.unitCode, unitName].filter(Boolean).join(' · ') || source.unitCode,
        }}
      />
    </div>
  );
}
