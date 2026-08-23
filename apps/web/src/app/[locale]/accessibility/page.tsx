import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';
export const metadata: Metadata = { title: 'إمكانية الوصول | Accessibility' };
export default function Page() {
  return <LegalPage titleKey="Legal.accessibilityTitle" bodyKey="Legal.accessibilityBody" />;
}
