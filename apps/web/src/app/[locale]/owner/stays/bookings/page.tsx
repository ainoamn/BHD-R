import { notFound } from 'next/navigation';
import { StaysPortalPage } from '@/components/stays/stays-portal-page';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';
import { apiFetch } from '@/lib/server-api';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  if (!isStaysPlatformEnabled()) notFound();
  const { locale } = await params;
  const bookings = await apiFetch<{ items: unknown[] }>('/v1/stays/bookings').catch(() => null);

  return (
    <StaysPortalPage locale={locale} portal="owner" section="bookings">
      <p className="muted">
        {locale === 'ar' ? 'حجوزات يومية' : 'Daily bookings'}:{' '}
        <strong>{bookings?.items?.length ?? 0}</strong>
      </p>
    </StaysPortalPage>
  );
}
