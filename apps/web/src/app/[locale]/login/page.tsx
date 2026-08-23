import type { Metadata } from 'next';
import { Logo } from '@bhd-r/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PasswordLoginForm } from '@/components/password-login-form';
import { Link } from '@/i18n/navigation';

export const metadata: Metadata = {
  title: 'الدخول الموحد | Unified sign in',
  robots: { index: false, follow: false },
};

const programmes = {
  ar: [
    ['و', 'وازن'],
    ['ح', 'حسابي'],
    ['ن', 'نَسَب'],
    ['R', 'BHD R'],
    ['م', 'المتجر'],
  ],
  en: [
    ['W', 'WAZEN'],
    ['H', 'HISABY'],
    ['N', 'NASAB'],
    ['R', 'BHD R'],
    ['S', 'Store'],
  ],
} as const;

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const ar = locale === 'ar';
  const returnTo = `/${locale}/portal`;

  return (
    <section className="login-screen">
      <div className="login-shell">
        <header className="login-top">
          <Link href="/" className="login-logo" aria-label={ar ? 'BHD R الرئيسية' : 'BHD R home'}>
            <Logo descriptor={t('Brand.descriptor')} />
          </Link>
          <Link
            href="/login"
            locale={ar ? 'en' : 'ar'}
            className="login-language"
            hrefLang={ar ? 'en' : 'ar'}
          >
            {ar ? 'English' : 'العربية'}
          </Link>
        </header>

        <div className="login-stage">
          <aside className="login-brand-panel">
            <span className="login-brand-kicker">{ar ? 'بوابة BHD R' : 'BHD R Gateway'}</span>
            <h1>
              {ar ? 'من هنا تبدأ إدارة عقار أوضح' : 'Clearer property management starts here'}
            </h1>
            <p>
              {ar
                ? 'سجّل دخولك إلى منظومة بن حمود للتطوير بهوية رقمية واحدة، ثم انتقل مباشرة إلى المساحة التي تسمح بها صلاحياتك داخل BHD R.'
                : 'Sign in to the Bin Hamood Development ecosystem with one digital identity, then continue to the exact BHD R workspace permitted by your role.'}
            </p>
            <p className="login-brand-highlight">
              {ar
                ? 'هوية واحدة. بيانات كل منتج مستقلة. صلاحيات كل دور محفوظة.'
                : 'One identity. Independent product data. Protected role boundaries.'}
            </p>
            <strong className="login-brand-promise">Build Higher Dreams</strong>
            <small>
              {ar
                ? 'مع بن حمود للتطوير، تبدأ الأحلام وتكبر.'
                : 'With Bin Hamood Development, dreams begin—and grow.'}
            </small>
          </aside>

          <div className="login-card">
            <span className="login-card__eyebrow">{ar ? 'الدخول الموحد' : 'Unified sign in'}</span>
            <h2>{ar ? 'مرحباً بك في BHD R' : 'Welcome to BHD R'}</h2>
            <p>
              {ar
                ? 'سننقلك إلى بوابة BHD الرسمية. لا تُدخل كلمة مرور BHD في أي صفحة أخرى.'
                : 'We will take you to the official BHD gateway. Never enter your BHD password on any other page.'}
            </p>
            <a
              className="login-submit"
              href={`/v1/auth/oidc/start?returnTo=${encodeURIComponent(returnTo)}`}
            >
              <span className="login-submit__mark" aria-hidden="true">
                B
              </span>
              {t('Auth.action')}
              <span aria-hidden="true">←</span>
            </a>
            <div className="login-security-note">
              <span aria-hidden="true">✓</span>
              <p>
                <strong>{ar ? 'دخول آمن ومركزي' : 'Secure, central sign-in'}</strong>
                <small>
                  {ar
                    ? 'يعود المستخدم إلى بوابته تلقائياً بعد التحقق.'
                    : 'You return to the correct portal automatically after verification.'}
                </small>
              </p>
            </div>

            <div className="login-divider">
              <span>{ar ? 'حساب المستأجر المحلي' : 'Local tenant account'}</span>
            </div>
            <details className="login-local">
              <summary>
                {ar
                  ? 'لدي اسم مستخدم مُنح لي مع عقد الإيجار'
                  : 'I received a username with my lease'}
              </summary>
              <div className="login-local__form">
                <PasswordLoginForm />
                <p className="muted">{t('Auth.activation')}</p>
                <Link href="/forgot-password">{ar ? 'نسيت كلمة المرور؟' : 'Forgot password?'}</Link>
              </div>
            </details>

            <p className="login-footnote">
              {ar ? 'بالمتابعة فإنك توافق على ' : 'By continuing, you agree to the '}
              <Link href="/privacy">{ar ? 'الخصوصية' : 'privacy policy'}</Link>
              {ar ? ' و' : ' and '}
              <Link href="/terms">{ar ? 'الشروط' : 'terms'}</Link>.
            </p>
          </div>
        </div>

        <nav className="login-programmes" aria-label={ar ? 'برامج المجموعة' : 'Group programmes'}>
          <p>{ar ? 'برامج المجموعة' : 'BHD programmes'}</p>
          <ul>
            {programmes[ar ? 'ar' : 'en'].map(([mark, name]) => (
              <li key={name}>
                <span aria-hidden="true">{mark}</span>
                {name}
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </section>
  );
}
