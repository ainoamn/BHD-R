/** Subtle in-place transition — avoid full-screen flash between portal pages. */
export default function PortalLoading() {
  return (
    <div className="portal-route-pending" role="status" aria-live="polite" aria-busy="true">
      <div className="portal-route-pending__bar" />
      <div className="portal-route-pending__body">
        <div className="portal-route-pending__line portal-route-pending__line--lg" />
        <div className="portal-route-pending__line" />
        <div className="portal-route-pending__line" />
        <div className="portal-route-pending__line portal-route-pending__line--short" />
      </div>
      <span className="sr-only">Loading · جارٍ التحميل…</span>
    </div>
  );
}
