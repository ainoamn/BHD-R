import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { BookingTermsOverview } from '@/components/booking-terms-overview';

async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  return <BookingTermsOverview locale={rawLocale === 'en' ? 'en' : 'ar'} portal="developer" />;
}

export default persistentPortalPage('/developer/terms', Page);
