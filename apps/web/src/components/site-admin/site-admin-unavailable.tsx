import Link from 'next/link';

/** Full-viewport gate when the tab's account is not on the site-admin allowlist. */
export function SiteAdminUnavailable({ locale = 'ar' }: { locale?: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  return (
    <main className="site-admin-gate" dir={ar ? 'rtl' : 'ltr'} lang={locale}>
      <div className="site-admin-gate__glow" aria-hidden="true" />
      <div className="site-admin-gate__panel">
        <p className="site-admin-gate__brand">
          <span className="site-admin-gate__mark" aria-hidden="true" />
          BHD R
          <span className="site-admin-gate__brand-sep" aria-hidden="true">
            ·
          </span>
          {ar ? 'تحكم الموقع' : 'Site console'}
        </p>
        <p className="site-admin-gate__code">403</p>
        <h1 className="site-admin-gate__title">
          {ar ? 'هذا الحساب لا يملك صلاحية التحكم' : 'This account cannot open the console'}
        </h1>
        <p className="site-admin-gate__lead">
          {ar
            ? 'التبويب مرتبط بحساب خارج قائمة مسؤولي الموقع. بدّل إلى حساب الإدارة من قائمة الحسابات، ثم أعد فتح الصفحة.'
            : 'This tab is bound to an account outside the site-admin allowlist. Switch to an admin account from the account menu, then open the console again.'}
        </p>
        <p className="site-admin-gate__aside" lang={ar ? 'en' : 'ar'}>
          {ar
            ? 'Switch to a listed admin account, then reopen /admin.'
            : 'بدّل إلى حساب مدرج في قائمة المسؤولين ثم أعد فتح /admin.'}
        </p>
        <div className="site-admin-gate__actions">
          <Link
            className="button button--primary site-admin-gate__primary"
            href={`/${locale}/login?next=${encodeURIComponent(`/${locale}/admin`)}`}
          >
            {ar ? 'تسجيل الدخول بحساب الإدارة' : 'Sign in with an admin account'}
          </Link>
          <Link className="button site-admin-gate__secondary" href={`/${locale}/portal`}>
            {ar ? 'العودة إلى البوابة' : 'Back to portal'}
          </Link>
        </div>
      </div>
    </main>
  );
}
