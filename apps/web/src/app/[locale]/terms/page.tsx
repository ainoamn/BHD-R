import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';
import { assertPublicSitePage } from '@/lib/site-page-gate';

export const metadata: Metadata = {
  title: 'شروط الاستخدام | Terms',
  robots: { index: true, follow: true },
};

export default async function Page() {
  await assertPublicSitePage('terms');
  return <LegalPage titleKey="Legal.termsTitle" bodyKey="Legal.termsBody" />;
}
