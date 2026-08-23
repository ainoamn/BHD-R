import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';
export const metadata: Metadata = {
  title: 'شروط الاستخدام | Terms',
  robots: { index: true, follow: true },
};
export default function Page() {
  return <LegalPage titleKey="Legal.termsTitle" bodyKey="Legal.termsBody" />;
}
