'use client';

export default function PropertyError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="section">
      <div className="container legal-content">
        <span className="eyebrow">تعذّر التحميل · Could not load</span>
        <h1>تعذّر فتح صفحة العقار</h1>
        <p>
          الاتصال استغرق وقتاً أطول من المعتاد أو انقطع أثناء التنقل. أعد المحاولة أو افتح الرابط
          مباشرة.
        </p>
        <div className="ops-inline-actions">
          <button type="button" className="button button--primary" onClick={() => reset()}>
            إعادة المحاولة · Reload
          </button>
          <button type="button" className="button button--quiet" onClick={() => window.history.back()}>
            رجوع · Back
          </button>
          <a className="button button--quiet" href="/ar/properties">
            العقارات المتاحة
          </a>
        </div>
      </div>
    </main>
  );
}
