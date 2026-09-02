import { redirect } from 'next/navigation';

export default async function AdminSectionAliasPage({
  params,
}: {
  params: Promise<{ locale: string; section: string[] }>;
}) {
  const { locale, section } = await params;
  redirect(`/${locale}/platform/${section.join('/')}`);
}
