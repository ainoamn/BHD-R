import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';
import { assertPublicSitePage } from '@/lib/site-page-gate';

export const metadata: Metadata = { title: 'الخصوصية | Privacy' };

export default async function Page() {
  await assertPublicSitePage('privacy');
  return <LegalPage titleKey="Legal.privacyTitle" bodyKey="Legal.privacyBody" />;
}
