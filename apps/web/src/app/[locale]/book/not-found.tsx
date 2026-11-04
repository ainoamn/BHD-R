import { Link } from '@/i18n/navigation';

/** Booking routes — do not reuse the catalogue «unit unpublished» wording. */
export default function BookNotFound() {
  return (
    <main className="container legal-content">
      <span className="eyebrow">404</span>
      <h1>الحجز غير متاح · Booking unavailable</h1>
      <p>
        لم يُعثر على هذا الحجز، أو انتهت صلاحيته، أو فُتح برابط يحتاج حساب المستأجر الذي أنشأه. إن
        صُفّرت بيانات التجربة من لوحة الإدارة فابدأ حجزاً جديداً من الكتالوج.
      </p>
      <p>
        This booking was not found, has expired, or needs the tenant account that created it. If
        test data was wiped from the admin lab reset, start a new booking from the catalogue.
      </p>
      <div className="guest-stay-detail__docs" style={{ marginTop: '1.25rem' }}>
        <Link className="button button--primary" href="/properties">
          العقارات المتاحة · Available properties
        </Link>
        <Link className="button button--quiet" href="/tenant/reservations">
          حجوزاتي · My bookings
        </Link>
      </div>
    </main>
  );
}
