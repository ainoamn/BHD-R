import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';
import { assertPublicSitePage } from '@/lib/site-page-gate';

export const metadata: Metadata = { title: 'إمكانية الوصول | Accessibility' };

export default async function Page() {
  await assertPublicSitePage('accessibility');
  return <LegalPage titleKey="Legal.accessibilityTitle" bodyKey="Legal.accessibilityBody" />;
}
