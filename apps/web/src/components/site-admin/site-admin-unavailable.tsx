import Link from 'next/link';

/** Shown when the signed-in account is not on the site-admin allowlist. */
export function SiteAdminUnavailable() {
  return (
    <main className="container legal-content" style={{ paddingBlock: '3rem' }}>
      <span className="eyebrow">404</span>
      <h1>تحكم الموقع غير متاح · Site console unavailable</h1>
      <p>
        هذه الصفحة لحسابات إدارة الموقع فقط. الحساب النشط في هذا التبويب غير مدرج في قائمة المسؤولين —
        بدّل إلى حساب الإدارة من قائمة الحسابات، أو سجّل الدخول بالحساب المدرج، ثم أعد فتح تحكم الموقع.
      </p>
      <p>
        This console is limited to site-admin accounts. The account bound to this tab is not on the
        allowlist — switch to an admin account in the account menu, or sign in with one, then open
        the console again.
      </p>
      <p style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
        <Link className="button button--primary" href="/ar/login?next=%2Far%2Fadmin">
          تسجيل الدخول · Sign in
        </Link>
        <Link className="button" href="/ar/portal">
          البوابة · Portal
        </Link>
      </p>
    </main>
  );
}
