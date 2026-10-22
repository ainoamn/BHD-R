import { redirect } from 'next/navigation';

/** Moved to site console — not part of the owner portal. */
export default async function RedirectOwnerNotifications({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/admin/notifications`);
}
