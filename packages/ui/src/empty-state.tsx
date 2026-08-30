import type { ReactNode } from 'react';
import { BrandMark } from './brand-mark.js';

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state" role="status">
      <span className="empty-state__mark" aria-hidden="true">
        <BrandMark />
      </span>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}
