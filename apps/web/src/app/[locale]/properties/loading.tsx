import { BrandMark } from '@bhd-r/ui';

export default function LoadingProperties() {
  return (
    <div className="container section" role="status" aria-live="polite">
      <div className="empty-state">
        <span className="empty-state__mark" aria-hidden="true">
          <BrandMark />
        </span>
        <p>Loading · جارٍ التحميل…</p>
      </div>
    </div>
  );
}
