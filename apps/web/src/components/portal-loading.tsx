/** In-main progress only — keep portal chrome (nav/header) visible during navigations. */
export default function PortalLoading() {
  return (
    <div className="portal-route-pending portal-route-pending--slim" role="status" aria-live="polite" aria-busy="true">
      <div className="portal-route-pending__bar" />
      <span className="sr-only">Loading · جارٍ التحميل…</span>
    </div>
  );
}
