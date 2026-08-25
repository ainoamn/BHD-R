export default function Loading() {
  return (
    <div className="container section" role="status" aria-live="polite">
      <div className="empty-state">
        <span className="empty-state__mark" aria-hidden="true">
          R
        </span>
        <p>Loading · جارٍ التحميل…</p>
      </div>
    </div>
  );
}
