/** Route-level skeleton — never leave marketing main blank for tens of seconds. */
export default function UnitLoading() {
  return (
    <div className="section" aria-busy="true" aria-live="polite">
      <div className="container">
        <div className="route-skeleton">
          <div className="route-skeleton__hero" />
          <div className="route-skeleton__line route-skeleton__line--lg" />
          <div className="route-skeleton__line" />
          <div className="route-skeleton__line route-skeleton__line--sm" />
          <div className="route-skeleton__grid">
            <div className="route-skeleton__card" />
            <div className="route-skeleton__card" />
            <div className="route-skeleton__card" />
          </div>
          <p className="muted route-skeleton__label">جاري تحميل الوحدة… · Loading unit…</p>
        </div>
      </div>
    </div>
  );
}
