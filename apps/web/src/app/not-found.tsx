export default function NotFound() {
  return (
    <main className="container legal-content">
      <span className="eyebrow">404</span>
      <h1>الصفحة غير متاحة · Page unavailable</h1>
      <p>
        الصفحة غير موجودة، أو الوحدة لم تعد معروضة للعامة (محجوزة / مؤجرة / غير منشورة). إن كنت
        تتصفح للتو من الكتالوج، جرّب التحديث أو العودة للقائمة.
      </p>
      <p>
        This page is missing, or the unit is no longer public (reserved / leased / unpublished). If
        you just opened it from the catalogue, refresh or return to the list.
      </p>
      <a className="button button--primary" href="/ar/properties">
        العقارات المتاحة
      </a>
    </main>
  );
}
