/** Reserved-height shell so /properties does not blank-paint then pop (CLS). */
export default function PropertiesLoading() {
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
          </div>
          <p className="muted route-skeleton__label">جاري تحميل العقارات… · Loading properties…</p>
        </div>
      </div>
    </div>
  );
}
