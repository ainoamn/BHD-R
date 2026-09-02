import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { RememberStayTripAlert } from '@/components/stays/remember-stay-trip-alert';
import { formatMoney } from '@/lib/format';
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

function stayTypeLabel(type: string | null | undefined, ar: boolean): string {
  if (type === 'day_use') return ar ? 'إقامة بدون مبيت' : 'Day use';
  if (type === 'overnight_only') return ar ? 'مبيت فقط' : 'Overnight only';
  if (type === 'overnight_stay') return ar ? 'إقامة مع مبيت' : 'Stay with overnight';
  return type ?? '—';
}

function guestHonorific(name: string | null | undefined, ar: boolean): string {
  const trimmed = name?.trim();
  if (!trimmed) return ar ? 'عزيزنا الضيف' : 'Dear guest';
  return ar ? `عزيزي ${trimmed}` : `Dear ${trimmed}`;
}

function confirmationWelcome(input: {
  ar: boolean;
  paid: boolean;
  guestName?: string | null;
  amountLabel?: string | null;
  referenceCode: string;
}): { title: string; body: string } {
  const dear = guestHonorific(input.guestName, input.ar);
  if (input.paid) {
    if (input.ar) {
      const amountPart = input.amountLabel ? ` بمبلغ إجمالي ${input.amountLabel}` : '';
      return {
        title: `${dear}، أهلاً بك`,
        body: `نودّ أن نؤكّد لك استلام حجزك، وأن الحجز والدفع قد تمّا بنجاح${amountPart} لرقم الحجز ${input.referenceCode}. نتطلّع لاستضافتك، ونتمنى لك إقامةً هانئة.`,
      };
    }
    const amountPart = input.amountLabel ? ` for a total of ${input.amountLabel}` : '';
    return {
      title: `${dear}, welcome`,
      body: `We are pleased to confirm that your booking has been received, and that both the reservation and payment were completed successfully${amountPart} under booking reference ${input.referenceCode}. We look forward to hosting you.`,
    };
  }
  if (input.ar) {
    return {
      title: `${dear}، أهلاً بك`,
      body: `نودّ أن نؤكّد لك استلام طلب حجزك برقم ${input.referenceCode}. يرجى إكمال الدفع لتأكيد الإقامة.`,
    };
  }
  return {
    title: `${dear}, welcome`,
    body: `We confirm receipt of your booking request under reference ${input.referenceCode}. Please complete payment to confirm your stay.`,
  };
}

async function loadBooking(ref: string): Promise<PublicBooking | null> {
  if (hasDatabaseUrl()) {
    try {
      return await lookupPublicStayBookingOnNeon(ref);
    } catch {
      // fall through to Nest rewrite
    }
  }
  return publicApiFetch<PublicBooking>(
    `/v1/public/stays/bookings/lookup?referenceCode=${encodeURIComponent(ref)}`,
    8,
  ).catch(() => null);
}

export default async function StayBookingConfirmedPage({
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

  const paid = booking.status === 'confirmed' || booking.status === 'paid';
  const stayTone =
    booking.stayType === 'day_use' || booking.stayType === 'overnight_only'
      ? booking.stayType
      : 'overnight_stay';
  const nights =
    typeof booking.nights === 'number'
      ? booking.nights
      : booking.checkInOn && booking.checkOutOn
        ? Math.max(
            0,
            Math.round(
              (Date.parse(`${booking.checkOutOn}T00:00:00.000Z`) -
                Date.parse(`${booking.checkInOn}T00:00:00.000Z`)) /
                86_400_000,
            ),
          )
        : null;

  const amountLabel =
    booking.totalMinor && booking.currency
      ? formatMoney(booking.totalMinor, booking.currency, locale)
      : null;
  const welcome = confirmationWelcome({
    ar,
    paid,
    guestName: booking.guestDisplayName ?? null,
    amountLabel,
    referenceCode: booking.referenceCode,
  });

  return (
    <section className="stay-confirm-shell" data-stay-immersive="true">
      <RememberStayTripAlert
        id={booking.id ?? booking.referenceCode}
        referenceCode={booking.referenceCode}
        status={booking.status}
        {...(booking.checkInOn ? { checkInOn: booking.checkInOn } : {})}
        {...(booking.checkOutOn ? { checkOutOn: booking.checkOutOn } : {})}
        {...(booking.currency ? { currency: booking.currency } : {})}
        {...(booking.totalMinor ? { totalMinor: booking.totalMinor } : {})}
      />

      <aside className="stay-confirm-shell__aside">
        <div className="stay-confirm-shell__aside-inner">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="stay-confirm-shell__aside-bg"
            src="/brand/oman-landmark-salalah.jpg"
            alt=""
          />
          <div className="stay-confirm-shell__aside-scrim" />
          <div className="stay-confirm-shell__aside-content">
            <p className="stay-confirm-shell__brand">BHD R</p>
            <h1 id="stays-booking-confirmed-title">{welcome.title}</h1>
            <p className="stay-confirm-shell__lede">{welcome.body}</p>
          </div>
        </div>
      </aside>

      <div className="stay-confirm-shell__panel">
        <header className="stay-confirm-shell__header">
          <h2>{ar ? 'تفاصيل الحجز' : 'Booking details'}</h2>
          <p className="muted">
            {paid
              ? ar
                ? 'يمكنك فتح الإيصال وحفظه كملف PDF.'
                : 'You can open the receipt and save it as PDF.'
              : ar
                ? 'راجع التفاصيل أدناه ثم أكمل الدفع عند الحاجة.'
                : 'Review the details below, then complete payment if needed.'}
          </p>
        </header>

        <dl className="stay-confirm-shell__grid">
          <div>
            <dt>{ar ? 'مرجع الحجز' : 'Booking reference'}</dt>
            <dd dir="ltr">
              <strong>{booking.referenceCode}</strong>
            </dd>
          </div>
          {booking.guestDisplayName ? (
            <div>
              <dt>{ar ? 'الضيف' : 'Guest'}</dt>
              <dd>{booking.guestDisplayName}</dd>
            </div>
          ) : null}
          {booking.checkInOn ? (
            <div>
              <dt>{ar ? 'الوصول' : 'Check-in'}</dt>
              <dd className="stays-checkout__chip stays-checkout__chip--check-in" dir="ltr">
                {booking.checkInOn}
              </dd>
            </div>
          ) : null}
          {booking.checkOutOn ? (
            <div>
              <dt>{ar ? 'المغادرة' : 'Check-out'}</dt>
              <dd className="stays-checkout__chip stays-checkout__chip--check-out" dir="ltr">
                {booking.checkOutOn}
              </dd>
            </div>
          ) : null}
          {typeof nights === 'number' ? (
            <div>
              <dt>{ar ? 'عدد الأيام' : 'Nights'}</dt>
              <dd>
                {nights}{' '}
                {ar ? (nights === 1 ? 'ليلة' : 'ليالٍ') : nights === 1 ? 'night' : 'nights'}
              </dd>
            </div>
          ) : null}
          {booking.stayType ? (
            <div>
              <dt>{ar ? 'نوع الحجز' : 'Stay type'}</dt>
              <dd className={`stays-checkout__chip stays-checkout__chip--stay-${stayTone}`}>
                {stayTypeLabel(booking.stayType, ar)}
              </dd>
            </div>
          ) : null}
          {typeof booking.adults === 'number' ? (
            <div>
              <dt>{ar ? 'بالغون' : 'Adults'}</dt>
              <dd className="stays-checkout__chip stays-checkout__chip--adults">
                {booking.adults}
              </dd>
            </div>
          ) : null}
          {typeof booking.children === 'number' ? (
            <div>
              <dt>{ar ? 'أطفال' : 'Children'}</dt>
              <dd className="stays-checkout__chip stays-checkout__chip--children">
                {booking.children}
              </dd>
            </div>
          ) : null}
          {booking.totalMinor && booking.currency ? (
            <div>
              <dt>{ar ? 'المجموع' : 'Total'}</dt>
              <dd dir="ltr">
                <strong>{formatMoney(booking.totalMinor, booking.currency, locale)}</strong>
              </dd>
            </div>
          ) : null}
          <div>
            <dt>{ar ? 'الحالة' : 'Status'}</dt>
            <dd>
              {booking.status === 'payment_pending' || booking.status === 'request_pending'
                ? ar
                  ? 'بانتظار الدفع'
                  : 'Awaiting payment'
                : paid
                  ? ar
                    ? 'مؤكّد'
                    : 'Confirmed'
                  : booking.status}
            </dd>
          </div>
        </dl>

        <div className="stay-confirm-shell__actions">
          <Link
            className="button button--primary"
            href={`/stays/booking/receipt?ref=${encodeURIComponent(ref)}`}
          >
            {ar ? 'إيصال الدفع (PDF)' : 'Payment receipt (PDF)'}
          </Link>
          <Link
            className="button button--quiet"
            href={`/guest/stays?ref=${encodeURIComponent(ref)}`}
          >
            {ar ? 'متابعة رحلتي' : 'Track my trip'}
          </Link>
          <Link className="button button--quiet" href="/stays">
            {ar ? 'ابحث عن إقامة أخرى' : 'Search another stay'}
          </Link>
        </div>

        {paid && booking.guestEmail ? (
          <p className="muted stay-confirm-shell__hint">
            {ar
              ? `أُرسلت رسالة تأكيد مع رابط الإيصال إلى ${booking.guestEmail}.`
              : `A confirmation email with the receipt link was sent to ${booking.guestEmail}.`}
          </p>
        ) : null}
        <p className="muted stay-confirm-shell__hint stays-booking-confirmed__review-hint">
          {ar
            ? 'بعد انتهاء الإقامة سيظهر لك طلب تقييم بأسلوب Booking.com من صفحة رحلاتي وصفحة الإقامة.'
            : 'After checkout ends, a Booking.com-style review invite appears on My trips and the stay page.'}
        </p>
      </div>
    </section>
  );
}
