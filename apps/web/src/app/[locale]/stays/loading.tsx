/** Soft-nav skeleton for /stays — never leave main blank while Neon hangs. */
export default function StaysLoading() {
  return (
    <div className="section" aria-busy="true" aria-live="polite">
      <div className="container">
        <div className="route-skeleton">
          <div className="route-skeleton__line route-skeleton__line--lg" />
          <div className="route-skeleton__line" />
          <div className="route-skeleton__grid">
            <div className="route-skeleton__card" />
            <div className="route-skeleton__card" />
            <div className="route-skeleton__card" />
            <div className="route-skeleton__card" />
          </div>
          <p className="muted route-skeleton__label">جاري تحميل الإقامات… · Loading stays…</p>
        </div>
      </div>
    </div>
  );
}
