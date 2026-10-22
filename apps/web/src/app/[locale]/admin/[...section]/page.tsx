import { redirect } from 'next/navigation';

/** Legacy /admin/* → dedicated site-admin console (system control only). */
export default async function AdminSectionAliasPage({
  params,
}: {
  params: Promise<{ locale: string; section: string[] }>;
}) {
  const { locale, section } = await params;
  const head = section[0] ?? '';
  const map: Record<string, string> = {
    diagnostics: '/site-admin/diagnostics',
    subscriptions: '/site-admin/plans',
    billing: '/site-admin/billing',
    security: '/site-admin/security',
    users: '/site-admin/users',
    complaints: '/site-admin/complaints',
    verification: '/site-admin/verification',
    delegates: '/site-admin/delegates',
    plans: '/site-admin/plans',
  };
  const target = map[head];
  if (target) {
    redirect(`/${locale}${target}`);
  }
  // Product-portal leftovers stay on thin /platform (not the site console).
  if (head === 'organizations' || head === 'audit' || head === 'reports' || head === 'settings') {
    redirect(`/${locale}/platform/${section.join('/')}`);
  }
  redirect(`/${locale}/site-admin`);
}
