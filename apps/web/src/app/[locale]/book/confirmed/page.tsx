import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { formatMoney, localizedName } from '@/lib/format';
import { leaseContractTitle } from '@/lib/lease-booking-contract';
import { leaseConfirmedPath } from '@/lib/lease-booking-paths';
import { loadLeaseBookingForViewer, leasePaymentPath } from '@/lib/public-lease-booking-neon';
import { getViewer } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Booking confirmed | تأكيد الحجز',
  robots: { index: false, follow: false, nocache: true },
};

function formatDate(iso: string | null, ar: boolean): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-GB', { dateStyle: 'medium' }).format(new Date(iso));
}

export default async function LeaseBookingConfirmedPage({
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
    redirect(`/${locale}/login?next=${encodeURIComponent(leaseConfirmedPath(locale, ref))}`);
  }

  const booking = await loadLeaseBookingForViewer(viewer.id, ref).catch(() => null);
  if (!booking) notFound();
  if (!booking.depositPaidAt && booking.status === 'pending') {
    redirect(leasePaymentPath(locale, booking.sessionReference, booking.referenceCode));
  }

  const paid = Boolean(booking.depositPaidAt);
  const signed = Boolean(booking.esignSignedAt);
  const sale = booking.mode === 'sale';
  const deposit = formatMoney(booking.depositMinor, booking.currency, locale);
  const priceMinor = sale ? booking.salePriceMinor : booking.rentMinor;
  const price = priceMinor && priceMinor !== '0' ? formatMoney(priceMinor, booking.currency, locale) : null;
  const property = `${localizedName(locale, booking.propertyNameAr, booking.propertyNameEn)} — ${localizedName(locale, booking.unitNameAr, booking.unitNameEn)}`;
  const contractTitle = leaseContractTitle(booking.mode);
  const forOther = booking.bookingFor === 'other';
  const name =
    (forOther ? booking.bookedByName : booking.contact.fullName) ||
    (ar ? 'العميل الكريم' : 'valued customer');
  const signHref = `/book/sign?ref=${encodeURIComponent(booking.referenceCode)}`;

  return (
    <section className="stay-confirm-shell" data-stay-immersive="true">
      <aside className="stay-confirm-shell__aside">
        <div className="stay-confirm-shell__aside-inner">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="stay-confirm-shell__aside-bg" src="/brand/oman-landmark-salalah.jpg" alt="" />
          <div className="stay-confirm-shell__aside-scrim" />
          <span
            className="stay-confirm-shell__logo logo__product logo__product--on-dark"
            aria-label="BHD R"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/bhd-official-symbol.svg" alt="" width="96" height="30" />
            <i>R</i>
          </span>
          <div className="stay-confirm-shell__aside-content">
            <p className="stay-confirm-shell__greeting">
              {ar ? 'عزيزي، أهلاً بك' : 'Dear, welcome'}
            </p>
            <h1 className="stay-confirm-shell__guest">{name}</h1>
            <p className="stay-confirm-shell__lede">
              {paid
                ? ar
                  ? `نؤكّد استلام مبلغ الضمان ${deposit} وحجز ${sale ? 'العقار للشراء' : 'الوحدة للإيجار'} باسمك. سيتواصل معك المالك لإتمام ${sale ? 'إجراءات البيع' : 'عقد الإيجار النهائي'}.`
                  : `We confirm receipt of your ${deposit} deposit and that the ${sale ? 'property is reserved for your purchase' : 'unit is reserved for your rental'}. The owner will contact you to finalise ${sale ? 'the sale' : 'the lease'}.`
                : ar
                  ? 'انتهت مهلة هذا الحجز قبل إتمام الدفع.'
                  : 'This booking expired before payment was completed.'}
            </p>
            <p className="stay-confirm-shell__ref-label">{ar ? 'رقم التأكيد' : 'Confirmation number'}</p>
            <p className="stay-confirm-shell__ref" dir="ltr">
              {booking.referenceCode}
            </p>
          </div>
        </div>
      </aside>

      <div className="stay-confirm-shell__panel">
        <header className="stay-confirm-shell__header">
          <h2>{ar ? 'تفاصيل الحجز' : 'Booking details'}</h2>
          <p className="muted">
            {paid && !signed
              ? ar
                ? 'تم الدفع بنجاح. يرجى توقيع العقد إلكترونياً وإرفاق مستنداتك لإتمام الاعتماد.'
                : 'Payment completed. Please e-sign the contract and attach your documents to complete approval.'
              : paid
                ? ar
                  ? 'العقد موقّع ومستنداتك مرفقة — لا يلزم أي إجراء آخر منك الآن.'
                  : 'Contract signed and documents attached — nothing else is needed from you now.'
                : ar
                  ? 'يمكنك بدء حجز جديد من صفحة العقار.'
                  : 'You can start a new booking from the property page.'}
          </p>
        </header>

        <dl className="stay-confirm-shell__grid">
          <div>
            <dt>{ar ? 'مرجع الحجز' : 'Booking reference'}</dt>
            <dd dir="ltr">
              <strong>{booking.referenceCode}</strong>
            </dd>
          </div>
          <div>
            <dt>{ar ? 'نوع الحجز' : 'Booking type'}</dt>
            <dd>{ar ? contractTitle.ar : contractTitle.en}</dd>
          </div>
          {forOther ? (
            <div>
              <dt>{sale ? (ar ? 'المشتري' : 'Buyer') : ar ? 'المستأجر' : 'Tenant'}</dt>
              <dd>{booking.contact.fullName}</dd>
            </div>
          ) : null}
          <div>
            <dt>{ar ? 'العقار' : 'Property'}</dt>
            <dd>{property}</dd>
          </div>
          <div>
            <dt>{sale ? (ar ? 'سعر البيع' : 'Sale price') : ar ? 'الإيجار الشهري' : 'Monthly rent'}</dt>
            <dd dir="ltr">{price ?? '—'}</dd>
          </div>
          <div>
            <dt>{ar ? 'مبلغ الضمان المدفوع' : 'Deposit paid'}</dt>
            <dd dir="ltr">
              <strong>{paid ? deposit : '—'}</strong>
            </dd>
          </div>
          <div>
            <dt>{ar ? 'تاريخ الدفع' : 'Paid on'}</dt>
            <dd>{formatDate(booking.depositPaidAt, ar)}</dd>
          </div>
          {paid ? (
            <div>
              <dt>{ar ? 'محجوز لك حتى' : 'Reserved for you until'}</dt>
              <dd>{formatDate(booking.reservedUntil, ar)}</dd>
            </div>
          ) : null}
          {paid ? (
            <div>
              <dt>{ar ? 'العقد الإلكتروني' : 'E-contract'}</dt>
              <dd>
                {signed
                  ? ar
                    ? 'معتمد إلكترونياً من بن حمود'
                    : 'Electronically approved by Bin Hamood'
                  : ar
                    ? 'بانتظار التوقيع'
                    : 'Awaiting signature'}
              </dd>
            </div>
          ) : null}
        </dl>

        <div className="stay-confirm-shell__actions">
          {paid ? (
            <Link
              className={`button button--primary${signed ? '' : ' stay-confirm-shell__esign-cta'}`}
              href={signHref}
            >
              {signed
                ? ar
                  ? 'عرض العقد الموقّع'
                  : 'View signed contract'
                : ar
                  ? 'توقيع العقد وإرفاق المستندات'
                  : 'Sign contract & attach documents'}
            </Link>
          ) : (
            <Link
              className="button button--primary"
              href={`/book/${booking.unitId}?mode=${booking.mode}`}
            >
              {ar ? 'ابدأ الحجز من جديد' : 'Start a new booking'}
            </Link>
          )}
          <Link className="button button--quiet" href={`/units/${booking.unitId}`}>
            {ar ? 'العودة للعقار' : 'Back to property'}
          </Link>
          <Link className="button button--quiet" href="/properties">
            {ar ? 'تصفح عقارات أخرى' : 'Browse other properties'}
          </Link>
        </div>
      </div>
    </section>
  );
}
