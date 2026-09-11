import { redirect } from 'next/navigation';
import { persistentPortalPage } from '@/lib/persistent-portal-page';

/** Legacy stays bookings list → unified bookings control screen. */
async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ propertyId?: string | string[] }>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  const propertyId = typeof query.propertyId === 'string' ? query.propertyId : undefined;
  const qs = new URLSearchParams({ tab: 'daily' });
  if (propertyId) qs.set('propertyId', propertyId);
  redirect(`/${locale}/developer/bookings?${qs.toString()}`);
}

export default persistentPortalPage('/developer/stays/bookings', Page);
