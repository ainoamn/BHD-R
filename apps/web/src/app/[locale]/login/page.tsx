import type { Metadata } from 'next';
import { Logo } from '@bhd-r/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { PasswordLoginForm } from '@/components/password-login-form';
import { Link } from '@/i18n/navigation';

export const metadata: Metadata = {
  title: 'الدخول الموحد | Unified sign in',
  robots: { index: false, follow: false },
};

const bhdErrors: Record<string, { ar: string; en: string }> = {
  state: {
    ar: 'انتهت صلاحية جلسة الدخول. حاول مرة أخرى.',
    en: 'Sign-in state expired. Please try again.',
  },
  token: {
    ar: 'تعذّر إكمال التحقق من الهوية.',
    en: 'Identity token exchange failed.',
  },
  session: {
    ar: 'تعذّر إنشاء جلسة BHD R. تأكد من تشغيل الـ API.',
    en: 'Could not create a BHD R session. Ensure the API is reachable.',
  },
  api: {
    ar: 'لم يُضبط عنوان API العام على Vercel (API_INTERNAL_ORIGIN).',
    en: 'Public API origin is not configured on Vercel (API_INTERNAL_ORIGIN).',
  },
  account: {
    ar: 'تعذّر ربط حساب الهوية بهذا المنتج.',
    en: 'Could not link this identity account to BHD R.',
  },
  discovery: {
    ar: 'تعذّر الوصول إلى اكتشاف الهوية.',
    en: 'Identity discovery is unreachable.',
  },
};

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();
  const ar = locale === 'ar';
  const local = query.local === '1';
  const bhdCode = typeof query.bhd === 'string' ? query.bhd : undefined;
  const nextRaw = typeof query.next === 'string' ? query.next : '';
  const returnTo =
    typeof query.returnTo === 'string' &&
    query.returnTo.startsWith('/') &&
    !query.returnTo.startsWith('//')
      ? query.returnTo
      : `/${locale}/portal`;

  // BHD-PRODUCT-SSO-ADMIN §3.2 — admin must never use local password login
  if (
    local &&
    (nextRaw.startsWith('/admin') ||
      nextRaw.startsWith('/platform') ||
      returnTo.startsWith('/admin') ||
      returnTo.startsWith('/platform') ||
      returnTo.includes('/platform'))
  ) {
    redirect(
      `/api/auth/admin-entry?next=${encodeURIComponent(
        nextRaw.startsWith('/') ? nextRaw : '/platform',
      )}`,
    );
  }

  if (!local && !bhdCode) {
    redirect(`/api/auth/bhd/start?returnTo=${encodeURIComponent(returnTo)}`);
  }

  const errorCopy = bhdCode
    ? (bhdErrors[bhdCode] ?? {
        ar: 'تعذّر إكمال الدخول الموحّد.',
        en: 'Unified sign-in could not be completed.',
      })
    : null;

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
                ? 'سجّل دخولك إلى منظومة بن حمود للتطوير بهوية رقمية واحدة.'
                : 'Sign in to the Bin Hamood Development ecosystem with one digital identity.'}
            </p>
            <strong className="login-brand-promise">Build Higher Dreams</strong>
          </aside>

          <div className="login-card">
            <span className="login-card__eyebrow">{ar ? 'الدخول الموحد' : 'Unified sign in'}</span>
            <h2>{ar ? 'مرحباً بك في BHD R' : 'Welcome to BHD R'}</h2>

            {errorCopy ? (
              <>
                <p role="alert">{ar ? errorCopy.ar : errorCopy.en}</p>
                <a
                  className="login-submit"
                  href={`/api/auth/bhd/start?returnTo=${encodeURIComponent(returnTo)}`}
                >
                  <span className="login-submit__mark" aria-hidden="true">
                    B
                  </span>
                  {t('Auth.action')}
                </a>
              </>
            ) : (
              <>
                <p>
                  {ar
                    ? 'طوارئ فقط: حساب مستأجر محلي مُنح مع عقد الإيجار.'
                    : 'Emergency only: local tenant account issued with a lease.'}
                </p>
                <div className="login-local__form">
                  <PasswordLoginForm />
                  <p className="muted">{t('Auth.activation')}</p>
                  <Link href="/forgot-password">
                    {ar ? 'نسيت كلمة المرور؟' : 'Forgot password?'}
                  </Link>
                </div>
                <p className="login-footnote">
                  <a href={`/api/auth/bhd/start?returnTo=${encodeURIComponent(returnTo)}`}>
                    {ar ? 'العودة إلى الدخول الموحّد' : 'Back to unified sign-in'}
                  </a>
                </p>
              </>
            )}

            <p className="login-footnote">
              {ar ? 'بالمتابعة فإنك توافق على ' : 'By continuing, you agree to the '}
              <Link href="/privacy">{ar ? 'الخصوصية' : 'privacy policy'}</Link>
              {ar ? ' و' : ' and '}
              <Link href="/terms">{ar ? 'الشروط' : 'terms'}</Link>.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
