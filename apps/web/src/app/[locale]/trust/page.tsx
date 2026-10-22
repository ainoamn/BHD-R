import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';
import { assertPublicSitePage } from '@/lib/site-page-gate';

export const metadata: Metadata = { title: 'الثقة والأمان | Trust & security' };

export default async function Page() {
  await assertPublicSitePage('trust');
  return <LegalPage titleKey="Legal.trustTitle" bodyKey="Legal.trustBody" />;
}
