import Link from 'next/link';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import { ContractArticle, type ContractArticleLinks } from '@/components/contract-document-view';
import { ContractDocumentToolbar } from '@/components/contract-document-toolbar';
import { LeaseReservationWorkflow } from '@/components/lease-reservation-workflow';
import { ReservationPartyCard } from '@/components/reservation-party-card';
import { formatMoney } from '@/lib/format';
import { leaseBookingAgreement, leaseContractTitle } from '@/lib/lease-booking-contract';
import { leaseSignPath } from '@/lib/lease-booking-paths';
import { leasePhaseLabel } from '@/lib/lease-reservation-lifecycle';
import type { loadLeaseBookingForStaff } from '@/lib/public-lease-booking-neon';

export type LeaseReservationStaffView = NonNullable<
  Awaited<ReturnType<typeof loadLeaseBookingForStaff>>
>;

export type ReservationPermissions = { canManage: boolean; canSign: boolean };

export function reservationPermissions(claims: SessionClaims): ReservationPermissions {
  return {
    canManage: hasPermission(claims, 'reservation.manage'),
    canSign: hasPermission(claims, 'contract.create') && hasPermission(claims, 'contract.sign'),
  };
}

const AGREEMENT_ID = 'reservation-agreement';

/** A website rent or purchase booking as the property side sees it, with its signed agreement. */
export function LeaseReservationDetail({
  booking,
  locale,
  portal,
  permissions,
}: {
  booking: LeaseReservationStaffView;
  locale: 'ar' | 'en';
  portal: 'owner' | 'developer';
  permissions: ReservationPermissions;
}) {
  const ar = locale === 'ar';
  const sale = booking.mode === 'sale';
  const title = leaseContractTitle(booking.mode);
  const { head, doc } = leaseBookingAgreement(booking);
  const signature = booking.signature;
  const self = `/${locale}/${portal}/bookings/${booking.reservationId}`;
  const links: ContractArticleLinks = {
    file: () => signature?.png ?? '',
    contract: () => self,
    annex: () => self,
  };
  const dateTime = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(ar ? 'ar-OM' : 'en-GB', {
          timeZone: 'Asia/Muscat',
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : '—';
  const day = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(ar ? 'ar-OM' : 'en-GB', {
          timeZone: 'Asia/Muscat',
          dateStyle: 'medium',
        })
      : '—';
  const property = ar ? booking.propertyNameAr : (booking.propertyNameEn ?? booking.propertyNameAr);
  const unit = ar ? booking.unitNameAr : (booking.unitNameEn ?? booking.unitNameAr);
  const deposit = formatMoney(booking.depositMinor, booking.currency, locale);
  const price = sale ? booking.salePriceMinor : booking.rentMinor;
  const awaitingApproval = booking.phase === 'awaiting_owner_approval';
  const bookingsHref = `/${locale}/${portal}/properties/${encodeURIComponent(booking.propertyId)}?section=bookings&focus=${encodeURIComponent(booking.reservationId)}`;

  return (
    <div className="form-shell contract-detail contract-detail--document">
      <header className="portal-topbar contract-detail__topbar">
        <div>
          <span className="ops-kicker">
            {sale ? 'BHD R · PURCHASE BOOKING' : 'BHD R · RENT BOOKING'}
          </span>
          <h1>
            <bdi dir="ltr">{booking.referenceCode}</bdi>
          </h1>
          <p>
            {property} · {booking.unitCode} {unit ? `(${unit})` : ''}
          </p>
        </div>
        <Link className="button button--quiet" href={bookingsHref} prefetch={false}>
          {ar ? 'حجوزات العقار' : 'Property bookings'}
        </Link>
      </header>

      {awaitingApproval ? (
        <p className="notice notice--info">
          {ar
            ? `دفع العميل العربون ووقّع اتفاقية الحجز. الوحدة محجوزة له حتى ${day(booking.reservedUntil)}؛ اعتمد الحجز ثم جهّز ${sale ? 'عقد البيع' : 'عقد الإيجار'} النهائي.`
            : `The client paid the deposit and signed the reservation agreement. The unit is held until ${day(booking.reservedUntil)}; approve the booking, then prepare the final ${sale ? 'sale' : 'lease'} contract.`}
        </p>
      ) : null}

      <LeaseReservationWorkflow
        reservationId={booking.reservationId}
        referenceCode={booking.referenceCode}
        locale={locale}
        portal={portal}
        mode={booking.mode}
        phase={booking.phase}
        lifecycle={booking.ownerLifecycle}
        unit={booking.formUnit}
        tenant={booking.formTenant}
        party={booking.party}
        salePriceMinor={booking.salePriceMinor}
        currency={booking.currency}
        depositLabel={deposit}
        depositPaidAt={booking.depositPaidAt}
        termsAcceptedAt={booking.termsAcceptedAt}
        hasEsign={Boolean(signature)}
        canManage={permissions.canManage}
        canSign={permissions.canSign}
      />

      <section className="ops-metrics" aria-label={ar ? 'ملخص الحجز' : 'Booking summary'}>
        <article>
          <span>{ar ? 'حالة الحجز' : 'Booking status'}</span>
          <strong>{leasePhaseLabel(booking.phase, ar)}</strong>
          <small>{ar ? (sale ? 'حجز شراء' : 'حجز إيجار') : sale ? 'Purchase' : 'Rent'}</small>
        </article>
        <article className="ops-metric--accent">
          <span>{ar ? 'العربون المدفوع' : 'Deposit paid'}</span>
          <strong dir="ltr">{booking.depositPaidAt ? deposit : '—'}</strong>
          <small>{dateTime(booking.depositPaidAt)}</small>
        </article>
        <article>
          <span>{ar ? 'محجوزة حتى' : 'Reserved until'}</span>
          <strong>{day(booking.reservedUntil)}</strong>
          <small>
            {price
              ? `${sale ? (ar ? 'سعر البيع' : 'Sale price') : ar ? 'الإيجار الشهري' : 'Monthly rent'} ${formatMoney(price, booking.currency, locale)}`
              : '—'}
          </small>
        </article>
        <article>
          <span>{ar ? 'التوقيع الإلكتروني' : 'E-signature'}</span>
          <strong>
            {signature?.serial ? (
              <bdi dir="ltr" className="doc-serial">
                {signature.serial}
              </bdi>
            ) : signature ? (
              ar ? (
                'موقّع'
              ) : (
                'Signed'
              )
            ) : ar ? (
              'لم يوقّع بعد'
            ) : (
              'Not signed yet'
            )}
          </strong>
          <small>{signature ? dateTime(signature.signedAt) : '—'}</small>
        </article>
      </section>

      <section className="ops-panel">
        <dl className="contract-detail__facts">
          <div>
            <dt>{ar ? 'العميل' : 'Client'}</dt>
            <dd>{booking.contact.fullName}</dd>
          </div>
          <div>
            <dt>{ar ? 'الهاتف' : 'Phone'}</dt>
            <dd>
              <a href={`tel:${booking.contact.phone}`} dir="ltr">
                {booking.contact.phone}
              </a>
            </dd>
          </div>
          <div>
            <dt>{ar ? 'البريد' : 'Email'}</dt>
            <dd dir="ltr">{booking.contact.email ?? '—'}</dd>
          </div>
          {booking.bookingFor === 'other' && booking.bookedByName ? (
            <div>
              <dt>{ar ? 'حجز بالنيابة عنه' : 'Booked on their behalf by'}</dt>
              <dd>
                {booking.bookedByName}
                {booking.bookedByEmail ? (
                  <>
                    {' '}
                    · <bdi dir="ltr">{booking.bookedByEmail}</bdi>
                  </>
                ) : null}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>{ar ? 'وسيلة الدفع' : 'Payment'}</dt>
            <dd>
              {booking.paymentProvider === 'bhd_pay_sandbox'
                ? ar
                  ? 'بوابة الدفع التجريبية'
                  : 'Sandbox payment'
                : (booking.paymentProvider ?? '—')}
              {booking.cardLast4 ? (
                <>
                  {' '}
                  ·{' '}
                  <bdi dir="ltr">
                    {booking.cardBrand ? `${booking.cardBrand} ` : ''}•••• {booking.cardLast4}
                  </bdi>
                </>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>{ar ? 'قبول الشروط' : 'Terms accepted'}</dt>
            <dd>{dateTime(booking.termsAcceptedAt)}</dd>
          </div>
        </dl>
      </section>

      {booking.party ? (
        <ReservationPartyCard party={booking.party} locale={locale} sale={sale} />
      ) : null}

      <ContractDocumentToolbar
        ar={ar}
        documentId={AGREEMENT_ID}
        title={ar ? title.ar : title.en}
        reference={booking.referenceCode}
        summary={`${booking.contact.fullName} · ${property} (${booking.unitCode}) · ${deposit}`}
        recipient={{
          name: booking.contact.fullName,
          email: booking.contact.email,
          phone: booking.contact.phone,
        }}
        recipientPath={leaseSignPath(locale, booking.referenceCode)}
        pdfUrl={null}
      />
      <ContractArticle id={AGREEMENT_ID} contract={head} doc={doc} locale={locale} links={links} />
    </div>
  );
}
