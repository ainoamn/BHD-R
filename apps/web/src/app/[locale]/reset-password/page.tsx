import type { Metadata } from 'next';
import { CredentialForm } from '@/components/credential-form';
export const metadata: Metadata = {
  title: 'استعادة كلمة المرور | Reset password',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const value = (await searchParams).token;
  const token = typeof value === 'string' ? value : '';
  if (token.length < 32 || token.length > 200)
    return (
      <main className="container legal-content">
        <h1>رابط الاستعادة غير صالح · Invalid reset link</h1>
      </main>
    );
  return <CredentialForm token={token} purpose="reset" />;
}
