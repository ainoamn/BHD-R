import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';
export const metadata: Metadata = { title: 'الثقة والأمان | Trust & security' };
export default function Page() {
  return <LegalPage titleKey="Legal.trustTitle" bodyKey="Legal.trustBody" />;
}
