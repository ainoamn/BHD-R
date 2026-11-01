import Link from 'next/link';

/** Segment not-found for /admin — never reuse the public catalogue 404 copy. */
export default function SiteAdminNotFound() {
  return (
    <main className="container legal-content" style={{ paddingBlock: '3rem' }}>
      <span className="eyebrow">404</span>
      <h1>تحكم الموقع غير متاح · Site console unavailable</h1>
      <p>
        هذه الصفحة ضمن تحكم الموقع. إن لم تكن مسجّلاً بحساب الإدارة فلن تظهر. سجّل الدخول بالحساب
        المدرج في قائمة مسؤولي الموقع، أو عد إلى البوابة.
      </p>
      <p>
        This page belongs to the site console. Sign in with a site-admin account, or return to the
        portal.
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
