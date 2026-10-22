import { redirect } from 'next/navigation';

export default async function RedirectPlatformBilling({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/site-admin/billing`);
}
