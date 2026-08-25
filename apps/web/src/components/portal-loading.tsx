export default function PortalLoading() {
  return (
    <div className="portal-main" role="status" aria-live="polite">
      <div className="empty-state" style={{ marginBlock: '2rem' }}>
        <span className="empty-state__mark" aria-hidden="true">
          R
        </span>
        <p>Loading · جارٍ التحميل…</p>
      </div>
    </div>
  );
}
