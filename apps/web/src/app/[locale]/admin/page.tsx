import { redirect } from 'next/navigation';

/** Short alias → site owner console (never owner/tenant portals). */
export default async function AdminUpperAliasPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/site-admin`);
}
