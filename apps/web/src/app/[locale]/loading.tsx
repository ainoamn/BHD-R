export default function Loading() {
  return (
    <div className="portal-route-pending" role="status" aria-live="polite" aria-busy="true">
      <div className="portal-route-pending__bar" />
      <div className="portal-route-pending__body" style={{ paddingInline: '1.25rem' }}>
        <div className="portal-route-pending__line portal-route-pending__line--lg" />
        <div className="portal-route-pending__line" />
      </div>
      <span className="sr-only">Loading · جارٍ التحميل…</span>
    </div>
  );
}
