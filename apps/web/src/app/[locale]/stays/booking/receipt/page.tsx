import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import {
  StayBookingDocument,
  type StayBookingDocumentKind,
} from '@/components/stays/stay-booking-document';
import { StayReceiptPrintButton } from '@/components/stays/stay-receipt-print-button';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { lookupPublicStayBookingOnNeon } from '@/lib/public-stays-guest-neon';
import { isStaysPublicSurfaceEnabled } from '@/lib/stays-flags';
import { publicApiFetch } from '@/lib/server-api';

type PublicBooking = {
  id?: string;
  referenceCode: string;
  status: string;
  checkInOn?: string;
  checkOutOn?: string;
  currency?: string;
  totalMinor?: string;
  nights?: number;
  guestDisplayName?: string | null;
  guestEmail?: string | null;
  adults?: number | null;
  children?: number | null;
  stayType?: string | null;
};

async function loadBooking(ref: string): Promise<PublicBooking | null> {
  if (hasDatabaseUrl()) {
    try {
      return await lookupPublicStayBookingOnNeon(ref);
    } catch {
      /* fall through */
    }
  }
  return publicApiFetch<PublicBooking>(
    `/v1/public/stays/bookings/lookup?referenceCode=${encodeURIComponent(ref)}`,
    8,
  ).catch(() => null);
}

function resolveDocKind(raw: string | string[] | undefined): StayBookingDocumentKind {
  const value = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined;
  return value === 'confirmation' ? 'confirmation' : 'payment';
}

export default async function StayBookingReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isStaysPublicSurfaceEnabled()) notFound();
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const ar = locale === 'ar';

  const refRaw = query.ref;
  const ref = typeof refRaw === 'string' ? refRaw : Array.isArray(refRaw) ? refRaw[0] : undefined;
  if (!ref) notFound();

  const booking = await loadBooking(ref);
  if (!booking) notFound();

  const kind = resolveDocKind(query.doc);
  const otherKind: StayBookingDocumentKind = kind === 'payment' ? 'confirmation' : 'payment';
  const title =
    kind === 'payment'
      ? ar
        ? 'إيصال الدفع'
        : 'Payment receipt'
      : ar
        ? 'تأكيد الحجز'
        : 'Booking confirmation';
  const otherLabel =
    otherKind === 'payment'
      ? ar
        ? 'إيصال الدفع'
        : 'Payment receipt'
      : ar
        ? 'تأكيد الحجز'
        : 'Booking confirmation';

  return (
    <div className="container section stays-booking-receipt">
      <div className="stays-booking-receipt__actions">
        <StayReceiptPrintButton
          locale={locale}
          label={ar ? 'تنزيل / طباعة PDF' : 'Download / print PDF'}
        />
        <Link
          className="button button--quiet"
          href={`/stays/booking/receipt?ref=${encodeURIComponent(ref)}&doc=${otherKind}`}
        >
          {otherLabel}
        </Link>
        <Link
          className="button button--quiet"
          href={`/stays/booking/confirmed?ref=${encodeURIComponent(ref)}`}
        >
          {ar ? 'العودة للتأكيد' : 'Back to confirmation'}
        </Link>
      </div>

      <header className="stays-booking-receipt__page-head">
        <h1 className="stays-booking-receipt__page-title">{title}</h1>
        <p className="muted">
          {ar
            ? 'مستند جاهز للطباعة أو الحفظ كملف PDF بنفس أسلوب الإيصالات الرسمية.'
            : 'Print-ready document — save as PDF in the same style as official receipts.'}
        </p>
      </header>

      <StayBookingDocument kind={kind} booking={booking} locale={locale} />
    </div>
  );
}
