import { redirect } from 'next/navigation';

/** Legacy path — console lives at /admin. */
export default async function LegacySiteAdminHome({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/admin`);
}
