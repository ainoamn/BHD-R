import { notFound } from 'next/navigation';
import { PropertyDetailManager, type ManagedProperty } from '@/components/property-detail-manager';
import { ApiError, apiFetch } from '@/lib/server-api';
import { requirePortal } from '@/lib/viewer';

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
}) {
  const { locale: rawLocale, propertyId } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  await requirePortal(locale, 'owner');
  try {
    const property = await apiFetch<ManagedProperty>(
      `/v1/portfolio/properties/${encodeURIComponent(propertyId)}`,
    );
    return <PropertyDetailManager property={property} locale={locale} portal="owner" />;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
