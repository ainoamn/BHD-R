'use client';
export default function PropertiesError({ reset }: { reset: () => void }) {
  return (
    <div className="container section">
      <div className="notice notice--error" role="alert">
        <p>تعذر تحميل العقارات · Properties could not be loaded.</p>
        <button type="button" className="button button--secondary" onClick={reset}>
          إعادة المحاولة · Try again
        </button>
      </div>
    </div>
  );
}
