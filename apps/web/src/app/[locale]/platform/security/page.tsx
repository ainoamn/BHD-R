import { redirect } from 'next/navigation';

export default async function RedirectPlatformSecurity({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/site-admin/security`);
}
