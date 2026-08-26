/** Locale-level pending: thin bar only to avoid full-page flash between routes. */
export default function Loading() {
  return (
    <div className="portal-route-pending portal-route-pending--slim" role="status" aria-live="polite" aria-busy="true">
      <div className="portal-route-pending__bar" />
      <span className="sr-only">Loading · جارٍ التحميل…</span>
    </div>
  );
}
