import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/components/forgot-password-form';
export const metadata: Metadata = {
  title: 'استعادة كلمة المرور | Password recovery',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};
export default function Page() {
  return <ForgotPasswordForm />;
}
