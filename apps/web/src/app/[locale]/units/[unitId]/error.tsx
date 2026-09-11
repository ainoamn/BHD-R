'use client';

/**
 * Soft-nav RSC streams can abort when Neon is slow; Next then shows its English
 * default global error. Prefer a bilingual retry that matches marketing UX.
 */
export default function UnitError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="section">
      <div className="container legal-content">
        <span className="eyebrow">تعذّر التحميل · Could not load</span>
        <h1>تعذّر فتح صفحة الوحدة</h1>
        <p>
          الاتصال استغرق وقتاً أطول من المعتاد أو انقطع أثناء التنقل. الوحدة موجودة غالباً —
          أعد المحاولة أو افتح الرابط مباشرة.
        </p>
        <p className="muted">This page could not finish loading. Retry, or open the link in a new tab.</p>
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
