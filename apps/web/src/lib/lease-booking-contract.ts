import 'server-only';
import { formatMoney, localizedName } from '@/lib/format';
import { bookingTermsDocument, termsBlocksFromStored } from '@/lib/booking-terms';
import { termsDocumentHtml } from '@/lib/terms-document-html';
import type { loadLeaseBookingForViewer } from '@/lib/public-lease-booking-neon';

export type LeaseBookingView = NonNullable<Awaited<ReturnType<typeof loadLeaseBookingForViewer>>>;

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(iso: string | null, ar: boolean): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-GB', { dateStyle: 'medium' }).format(
    new Date(iso),
  );
}

export function leaseContractTitle(mode: 'rent' | 'sale') {
  return mode === 'sale'
    ? { ar: 'اتفاقية حجز عقار للشراء', en: 'Purchase reservation agreement' }
    : { ar: 'اتفاقية حجز وحدة للإيجار', en: 'Rental reservation agreement' };
}

export function buildLeaseContractHtml(booking: LeaseBookingView, locale: 'ar' | 'en'): string {
  const ar = locale === 'ar';
  const title = leaseContractTitle(booking.mode);
  const deposit = formatMoney(booking.depositMinor, booking.currency, locale);
  const priceMinor = booking.mode === 'sale' ? booking.salePriceMinor : booking.rentMinor;
  const price =
    priceMinor && priceMinor !== '0' ? formatMoney(priceMinor, booking.currency, locale) : null;
  const property = `${localizedName(locale, booking.propertyNameAr, booking.propertyNameEn)} — ${localizedName(locale, booking.unitNameAr, booking.unitNameEn)}`;
  const terms = bookingTermsDocument({
    mode: booking.mode,
    depositAr: formatMoney(booking.depositMinor, booking.currency, 'ar'),
    depositEn: formatMoney(booking.depositMinor, booking.currency, 'en'),
    blocks: booking.ownerTerms ? termsBlocksFromStored(booking.ownerTerms) : null,
  });
  const row = (label: string, value: string, ltr = false) =>
    `<div class="stay-doc__row"><dt>${escapeHtml(label)}</dt><dd${ltr ? ' dir="ltr"' : ''}>${escapeHtml(value)}</dd></div>`;

  return `
    <article class="stay-doc stay-doc--contract">
      <header class="stay-doc__header">
        <div class="stay-doc__brand">
          <span class="stay-doc__logo logo__product" aria-label="BHD R">
            <img src="/brand/bhd-official-symbol.svg" alt="" width="88" height="28" />
            <i>R</i>
          </span>
          <p class="stay-doc__tagline">${escapeHtml(ar ? title.ar : title.en)}</p>
        </div>
        <div class="stay-doc__meta">
          <p class="stay-doc__kind">${ar ? 'مستند الحجز' : 'Booking record'}</p>
          <p class="stay-doc__number" dir="ltr">${escapeHtml(booking.referenceCode)}</p>
        </div>
      </header>
      <dl class="stay-doc__grid">
        ${row(ar ? (booking.mode === 'sale' ? 'المشتري' : 'المستأجر') : booking.mode === 'sale' ? 'Buyer' : 'Tenant', booking.contact.fullName)}
        ${row(ar ? 'الهاتف' : 'Phone', booking.contact.phone, true)}
        ${booking.bookingFor === 'other' && booking.bookedByName ? row(ar ? 'تم الحجز بواسطة' : 'Booked by', booking.bookedByName) : ''}
        ${row(ar ? 'العقار' : 'Property', property)}
        ${row(ar ? 'رمز الوحدة' : 'Unit code', booking.unitCode, true)}
        ${row(booking.mode === 'sale' ? (ar ? 'سعر البيع' : 'Sale price') : ar ? 'الإيجار الشهري' : 'Monthly rent', price ?? '—', true)}
        ${row(ar ? 'مبلغ الضمان المدفوع' : 'Deposit paid', deposit, true)}
        ${row(ar ? 'تاريخ الدفع' : 'Paid on', formatDate(booking.depositPaidAt, ar))}
        ${row(ar ? 'محجوز حتى' : 'Reserved until', formatDate(booking.reservedUntil, ar))}
      </dl>
      <p class="stay-doc__subtitle">${ar ? 'الشروط والأحكام' : 'Terms and conditions'}</p>
      ${termsDocumentHtml(terms)}
    </article>
  `;
}
