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
    ar: 'انتهت صلاحية جلسة الدخول. حاول مرة أخرى عبر بوابة الهوية.',
    en: 'Sign-in state expired. Please try again via the identity gateway.',
  },
  token: {
    ar: 'تعذّر إكمال التحقق من الهوية على الخادم.',
    en: 'Identity token exchange failed on the server.',
  },
  api: {
    ar: 'لم تُضبط قاعدة البيانات على Vercel (DATABASE_URL).',
    en: 'DATABASE_URL is not configured on Vercel.',
  },
  verify: {
    ar: 'تعذّر التحقق من توكن الهوية بعد العودة من id.bhd-om.com. راجع BHD_IDENTITY_TOKEN_SECRET.',
    en: 'Could not verify the identity token after returning from id.bhd-om.com. Check BHD_IDENTITY_TOKEN_SECRET.',
  },
  verify_userinfo: {
    ar: 'تعذّر جلب بيانات المستخدم من /oauth/userinfo بعد نجاح الكود.',
    en: 'Could not load userinfo after a successful authorization code.',
  },
  verify_nonce: {
    ar: 'فشل التحقق من nonce بين المنتج والهوية.',
    en: 'OIDC nonce check failed between the product and Identity.',
  },
  verify_claims: {
    ar: 'مطالبات التوكن (iss/aud) لا تطابق إعدادات عميل bhd-r.',
    en: 'Token claims (iss/aud) do not match the bhd-r client settings.',
  },
  db: {
    ar: 'تعذّر الاتصال بقاعدة بيانات BHD R.',
    en: 'Could not reach the BHD R database.',
  },
  upsert: {
    ar: 'تعذّر ربط أو إنشاء مستخدم المنتج بعد الدخول.',
    en: 'Could not link or create the product user after sign-in.',
  },
  session: {
    ar: 'تعذّر إنشاء جلسة BHD R بعد التحقق من الهوية.',
    en: 'Could not create a BHD R session after identity verification.',
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

  // §3.2 — no product password portal; credentials live only on id.bhd-om.com
  if (!local && !bhdCode) {
    redirect(`/api/auth/bhd/start?returnTo=${encodeURIComponent(returnTo)}`);
  }

  const startHref = `/api/auth/bhd/start?returnTo=${encodeURIComponent(returnTo)}`;
  const errorCopy = bhdCode
    ? (bhdErrors[bhdCode] ?? {
        ar: 'تعذّر إكمال الدخول الموحّد عبر id.bhd-om.com.',
        en: 'Unified sign-in via id.bhd-om.com could not be completed.',
      })
    : null;

  return (
    <section className="login-screen">
      <div className="login-shell login-shell--compact">
        <header className="login-top">
          <Link href="/" className="login-logo" aria-label={ar ? 'BHD R الرئيسية' : 'BHD R home'}>
            <Logo descriptor={t('Brand.descriptor')} />
          </Link>
          <Link
            href={local ? '/login?local=1' : '/login'}
            locale={ar ? 'en' : 'ar'}
            className="login-language"
            hrefLang={ar ? 'en' : 'ar'}
          >
            {ar ? 'English' : 'العربية'}
          </Link>
        </header>

        <div className="login-card login-card--compact">
          {errorCopy ? (
            <>
              <span className="login-card__eyebrow">
                {ar ? 'الدخول عبر بوابة الهوية' : 'Sign-in via Identity gateway'}
              </span>
              <h2>{ar ? 'لم يكتمل الدخول الموحّد' : 'Unified sign-in did not finish'}</h2>
              <p role="alert">{ar ? errorCopy.ar : errorCopy.en}</p>
              <p>
                {ar
                  ? 'كلمات المرور تُدخل فقط على بوابة الهوية الموحّدة، وليست على BHD R:'
                  : 'Passwords are entered only on the unified identity gateway, not on BHD R:'}{' '}
                <a href="https://id.bhd-om.com/login">https://id.bhd-om.com/login</a>
              </p>
              <a className="login-submit" href={startHref}>
                <span className="login-submit__mark" aria-hidden="true">
                  B
                </span>
                {ar ? 'إعادة المحاولة عبر id.bhd-om.com' : 'Retry via id.bhd-om.com'}
              </a>
            </>
          ) : (
            <>
              <span className="login-card__eyebrow">
                {ar ? 'طوارئ محلية فقط' : 'Local emergency only'}
              </span>
              <h2>{ar ? 'دخول مستأجر محلي' : 'Local tenant sign-in'}</h2>
              <p>
                {ar
                  ? 'كلمة المرور هنا للمستأجر عند الطوارئ فقط. الدخول العادي عبر:'
                  : 'Password here is for tenant emergencies only. Normal sign-in via:'}{' '}
                <a href="https://id.bhd-om.com/login">id.bhd-om.com</a>
              </p>
              <div className="login-local__form">
                <PasswordLoginForm />
                <p className="muted">{t('Auth.activation')}</p>
                <Link href="/forgot-password">
                  {ar ? 'نسيت كلمة المرور؟' : 'Forgot password?'}
                </Link>
              </div>
              <p className="login-footnote">
                <a href={startHref}>
                  {ar
                    ? 'العودة إلى الدخول الموحّد (id.bhd-om.com)'
                    : 'Back to unified sign-in (id.bhd-om.com)'}
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
    </section>
  );
}
