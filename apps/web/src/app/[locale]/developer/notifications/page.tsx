import { redirect } from 'next/navigation';

/** Moved to site console — not part of the developer portal. */
export default async function RedirectDeveloperNotifications({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/site-admin/notifications`);
}
