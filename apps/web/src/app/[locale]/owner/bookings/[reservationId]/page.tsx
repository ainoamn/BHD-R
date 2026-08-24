import { notFound } from 'next/navigation';
import {
  ReservationComplianceManager,
  type ReservationCompliance,
} from '@/components/reservation-compliance-manager';
import { ApiError, apiFetch } from '@/lib/server-api';
import { requirePortal } from '@/lib/viewer';

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; reservationId: string }>;
}) {
  const { locale: rawLocale, reservationId } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  await requirePortal(locale, 'owner');
  try {
    const compliance = await apiFetch<ReservationCompliance>(
      `/v1/leasing/reservations/${encodeURIComponent(reservationId)}/compliance`,
    );
    return <ReservationComplianceManager compliance={compliance} locale={locale} portal="owner" />;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
