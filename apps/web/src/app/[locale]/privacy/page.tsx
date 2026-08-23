import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';
export const metadata: Metadata = { title: 'الخصوصية | Privacy' };
export default function Page() {
  return <LegalPage titleKey="Legal.privacyTitle" bodyKey="Legal.privacyBody" />;
}
