import { TenantSpace } from '@/components/tenant-space';
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <TenantSpace locale={locale} view="bookings" />;
}
