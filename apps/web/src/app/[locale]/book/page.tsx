import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

export const dynamic = 'force-dynamic';

/**
 * `/book` alone is not a booking — bookings need a unit id (`/book/:unitId`) or a
 * reference (`/book/confirmed?ref=…`). Send bare visits to the catalogue.
 */
export default async function BookIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  redirect(`/${locale}/properties`);
}
