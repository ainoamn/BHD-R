import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { StayEsignWizard } from '@/components/stays/stay-esign-wizard';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { lookupPublicStayBookingOnNeon } from '@/lib/public-stays-guest-neon';
import { isStayEsignRequiredServer } from '@/lib/stay-esign-flags';
import { isStaysPublicSurfaceEnabled } from '@/lib/stays-flags';
import { formatMoney } from '@/lib/format';

export default async function StayBookingSignPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isStaysPublicSurfaceEnabled()) notFound();
  if (!isStayEsignRequiredServer()) notFound();
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const ar = locale === 'ar';
  const query = await searchParams;
  const refRaw = query.ref;
  const referenceCode =
    typeof refRaw === 'string' ? refRaw : Array.isArray(refRaw) ? refRaw[0] : undefined;
  if (!referenceCode || !hasDatabaseUrl()) notFound();

  const booking = await lookupPublicStayBookingOnNeon(referenceCode).catch(() => null);
  if (!booking || (booking.status !== 'confirmed' && booking.status !== 'paid')) {
    notFound();
  }

  const amount =
    booking.totalMinor && booking.currency
      ? formatMoney(booking.totalMinor, booking.currency, locale)
      : '—';

  const contractHtml = `
    <article class="stay-doc stay-doc--contract">
      <header class="stay-doc__header">
        <div class="stay-doc__brand">
          <span class="stay-doc__logo logo__product" aria-label="BHD R">
            <img src="/brand/bhd-official-symbol.svg" alt="" width="88" height="28" />
            <i>R</i>
          </span>
          <p class="stay-doc__tagline">${ar ? 'عقد إقامة يومية' : 'Daily stay contract'}</p>
        </div>
        <div class="stay-doc__meta">
          <p class="stay-doc__kind">${ar ? 'مستند الحجز' : 'Booking record'}</p>
          <p class="stay-doc__number" dir="ltr">${booking.referenceCode}</p>
        </div>
      </header>
      <dl class="stay-doc__grid">
        <div class="stay-doc__row"><dt>${ar ? 'الضيف' : 'Guest'}</dt><dd>${booking.guestDisplayName ?? '—'}</dd></div>
        <div class="stay-doc__row"><dt>${ar ? 'الهاتف' : 'Phone'}</dt><dd dir="ltr">${booking.guestPhone ?? '—'}</dd></div>
        <div class="stay-doc__row"><dt>${ar ? 'الوصول' : 'Check-in'}</dt><dd dir="ltr">${booking.checkInOn}</dd></div>
        <div class="stay-doc__row"><dt>${ar ? 'المغادرة' : 'Check-out'}</dt><dd dir="ltr">${booking.checkOutOn}</dd></div>
        <div class="stay-doc__row"><dt>${ar ? 'المبلغ' : 'Amount'}</dt><dd dir="ltr">${amount}</dd></div>
      </dl>
      <p class="stay-doc__subtitle">
        ${
          ar
            ? 'بالتوقيع أوافق على سياسات الإقامة والإلغاء ومبلغ التأمين وشروط الاستخدام الخاصة بالعقار.'
            : 'By signing I agree to the stay policies, cancellation rules, deposit terms, and property house rules.'
        }
      </p>
    </article>
  `;

  return (
    <main className="stay-esign-shell">
      <StayEsignWizard
        locale={locale}
        referenceCode={referenceCode}
        contractHtml={contractHtml}
        initiallyComplete={Boolean(booking.esignCompleted)}
      />
    </main>
  );
}
