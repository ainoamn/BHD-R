'use client';

import { useState } from 'react';
import { Link } from '@/i18n/navigation';

const PREVIEW_ROWS = 5;

export type DashAttentionAlert = {
  key: string;
  count: number;
  label: string;
  href: string | null;
  tone: 'danger' | 'warning' | 'info' | 'approval' | 'contract-new' | 'contract-renewal';
};

/** Classic row list for dashboard alerts — max 5, expandable. */
export function DashAttentionAlerts({
  items,
  emptyLabel,
  expandMoreLabel,
  collapseLabel,
  allHref,
  allLabel,
}: {
  items: DashAttentionAlert[];
  emptyLabel: string;
  expandMoreLabel: string;
  collapseLabel: string;
  allHref?: string;
  allLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!items.length) {
    return emptyLabel ? <p className="dash-alerts__empty">{emptyLabel}</p> : null;
  }

  const hidden = Math.max(0, items.length - PREVIEW_ROWS);
  const visible = expanded ? items : items.slice(0, PREVIEW_ROWS);

  return (
    <div className="dash-alert-rows">
      <ul className="dash-alert-rows__list">
        {visible.map((item) => {
          const body = (
            <>
              <strong>{item.count}</strong>
              <span>{item.label}</span>
            </>
          );
          return (
            <li key={item.key} className={`dash-alert-rows__item dash-alert-rows__item--${item.tone}`}>
              {item.href ? (
                <Link href={item.href} prefetch className="dash-alert-rows__link">
                  {body}
                </Link>
              ) : (
                <span className="dash-alert-rows__link dash-alert-rows__link--static">{body}</span>
              )}
            </li>
          );
        })}
      </ul>
      {hidden > 0 || allHref ? (
        <div className="dash-approvals__footer">
          {hidden > 0 ? (
            <button
              type="button"
              className="dash-approvals__expand"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
            >
              {expanded ? collapseLabel : expandMoreLabel.replace('{count}', String(hidden))}
            </button>
          ) : (
            <span />
          )}
          {allHref && allLabel ? (
            <Link href={allHref} className="dash-approvals__all" prefetch>
              {allLabel}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
