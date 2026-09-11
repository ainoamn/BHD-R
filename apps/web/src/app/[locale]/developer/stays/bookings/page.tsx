import { redirect } from 'next/navigation';

/** Legacy stays bookings list → unified bookings control screen. */
export default async function Page({
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
