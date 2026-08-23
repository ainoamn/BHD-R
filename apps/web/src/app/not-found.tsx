export default function NotFound() {
  return (
    <main className="container legal-content">
      <span className="eyebrow">404</span>
      <h1>الصفحة غير متاحة · Page unavailable</h1>
      <p>قد تكون الوحدة حُجزت أو أُجرت، لذلك أزلنا تفاصيلها من العرض العام.</p>
      <a className="button button--primary" href="/ar/properties">
        العقارات المتاحة
      </a>
    </main>
  );
}
