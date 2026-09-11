/** Route-level skeleton for public property detail. */
export default function PropertyLoading() {
  return (
    <div className="section" aria-busy="true" aria-live="polite">
      <div className="container">
        <div className="route-skeleton">
          <div className="route-skeleton__hero" />
          <div className="route-skeleton__line route-skeleton__line--lg" />
          <div className="route-skeleton__line" />
          <div className="route-skeleton__line route-skeleton__line--sm" />
          <p className="muted route-skeleton__label">جاري تحميل العقار… · Loading property…</p>
        </div>
      </div>
    </div>
  );
}
