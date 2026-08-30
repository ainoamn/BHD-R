import { redirect } from 'next/navigation';
import { Card, CardContent } from '@bhd-r/ui';
import { BookingCheckoutForm } from '@/components/booking-checkout-form';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { localizedName } from '@/lib/format';
import { loadPublicUnitDeposit } from '@/lib/public-booking-neon';
import { getViewer } from '@/lib/viewer';

export default async function BookUnitPage({
  params,
}: {
  params: Promise<{ locale: string; unitId: string }>;
}) {
  const { locale: rawLocale, unitId } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  const viewer = await getViewer();
  if (!viewer) {
    redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/book/${unitId}`)}`);
  }
  if (!hasDatabaseUrl()) redirect(`/${locale}/units/${unitId}`);

  const unit = await loadPublicUnitDeposit(unitId).catch(() => null);
  if (!unit?.depositMinor || unit.depositMinor <= 0n) {
    redirect(`/${locale}/units/${unitId}`);
  }

  const title = `${localizedName(locale, unit.propertyNameAr, unit.propertyNameEn)} — ${localizedName(locale, unit.nameAr, unit.nameEn)}`;
  const ar = locale === 'ar';

  return (
    <section className="section">
      <div className="container" style={{ maxWidth: '32rem' }}>
        <Card>
          <CardContent>
            <span className="eyebrow">BHD R · {ar ? 'حجز' : 'BOOKING'}</span>
            <BookingCheckoutForm
              unitId={unitId}
              locale={locale}
              depositMinor={unit.depositMinor.toString()}
              currency={unit.currency}
              title={title}
            />
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
