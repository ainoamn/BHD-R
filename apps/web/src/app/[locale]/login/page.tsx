import type { Metadata } from 'next';
import { Logo } from '@bhd-r/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PasswordLoginForm } from '@/components/password-login-form';
import { Link } from '@/i18n/navigation';

export const metadata: Metadata = {
  title: 'الدخول الموحد | Unified sign in',
  robots: { index: false, follow: false },
};

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const returnTo = `/${locale}/portal`;
  return (
    <section className="auth-shell">
      <div className="card auth-card">
        <Logo descriptor={t('Brand.descriptor')} />
        <h1>{t('Auth.title')}</h1>
        <p>{t('Auth.text')}</p>
        <a
          className="button button--primary"
          href={`/v1/auth/oidc/start?returnTo=${encodeURIComponent(returnTo)}`}
        >
          {t('Auth.action')}
        </a>
        <div className="auth-divider">
          <span>{locale === 'ar' ? 'أو حساب المستأجر' : 'or tenant account'}</span>
        </div>
        <PasswordLoginForm />
        <p className="muted">{t('Auth.activation')}</p>
        <Link href="/forgot-password">
          {locale === 'ar' ? 'نسيت كلمة المرور؟' : 'Forgot password?'}
        </Link>
      </div>
    </section>
  );
}
