/** Instant fallback for a cold route; the shared header/sidebar stay mounted. */
export default function PortalLoading() {
  return (
    <div className="portal-section-skeleton" role="status" aria-live="polite">
      <span className="sr-only">Loading section</span>
      <div className="portal-section-skeleton__hero">
        <i />
        <b />
        <span />
      </div>
      <div className="portal-section-skeleton__metrics">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="portal-section-skeleton__table" />
    </div>
  );
}
