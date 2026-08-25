export default function LoadingNewProperty() {
  return (
    <div className="portal-route-pending" role="status" aria-live="polite" aria-busy="true">
      <div className="portal-route-pending__bar" />
      <header className="portal-topbar">
        <div>
          <div className="portal-route-pending__line portal-route-pending__line--lg" />
          <div className="portal-route-pending__line portal-route-pending__line--short" />
        </div>
      </header>
      <div className="portal-route-pending__body">
        <div className="portal-route-pending__card" />
        <div className="portal-route-pending__card" />
      </div>
      <span className="sr-only">Loading · جارٍ التحميل…</span>
    </div>
  );
}
