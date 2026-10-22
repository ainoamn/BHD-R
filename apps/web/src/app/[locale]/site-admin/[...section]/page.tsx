import { redirect } from 'next/navigation';

/** Legacy /site-admin/* → /admin/*. */
export default async function LegacySiteAdminSection({
  params,
}: {
  params: Promise<{ locale: string; section: string[] }>;
}) {
  const { locale, section } = await params;
  redirect(`/${locale}/admin/${section.join('/')}`);
}
