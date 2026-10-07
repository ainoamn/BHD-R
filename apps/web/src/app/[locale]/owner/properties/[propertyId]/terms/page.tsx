import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { BookingTermsPage } from '@/components/booking-terms-page';

async function Page({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
}) {
  const { locale: rawLocale, propertyId } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  return <BookingTermsPage locale={locale} portal="owner" propertyId={propertyId} />;
}

export default persistentPortalPage('/owner/properties/[propertyId]/terms', Page);
