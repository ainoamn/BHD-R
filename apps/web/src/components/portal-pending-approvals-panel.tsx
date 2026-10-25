'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import {
  PENDING_APPROVALS_CHANGED_EVENT,
  pendingApprovalAmount,
  pendingApprovalHref,
  pendingApprovalTitle,
  type PendingApprovals,
} from '@/lib/pending-approvals-shared';
import type { PortalRole } from '@/lib/types';

/**
 * Dashboard pending list that refetches on live-sync pulses, so a new booking
 * appears without a full page reload even when RSC refresh is slow or skipped.
 */
export function PortalPendingApprovalsPanel({
  portal,
  locale,
  initial,
  title,
  hint,
  openLabel,
  moreLabel,
}: {
  portal: PortalRole;
  locale: string;
  initial: PendingApprovals;
  title: string;
  hint: string;
  openLabel: string;
  moreLabel: (count: number) => string;
}) {
  const ar = locale === 'ar';
  const [data, setData] = useState<PendingApprovals>(initial);

  useEffect(() => {
    setData(initial);
  }, [initial]);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/portal/pending-approvals', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) return;
      setData((await response.json()) as PendingApprovals);
    } catch {
      /* keep the last known list */
    }
  }, []);

  useEffect(() => {
    const reload = () => void load();
    window.addEventListener(PENDING_APPROVALS_CHANGED_EVENT, reload);
    window.addEventListener('bhd-r-ops-refresh', reload);
    return () => {
      window.removeEventListener(PENDING_APPROVALS_CHANGED_EVENT, reload);
      window.removeEventListener('bhd-r-ops-refresh', reload);
    };
  }, [load]);

  if (!data.total) return null;

  return (
    <section
      id="pending-approvals"
      className="dash-approvals"
      aria-label={title}
    >
      <div className="dash-section-head dash-section-head--compact">
        <h2>
          {title}
          <span className="dash-approvals__count">{data.total}</span>
        </h2>
        <p className="dash-section-hint">{hint}</p>
      </div>
      <ul className="dash-approvals__list">
        {data.items.slice(0, 6).map((item) => (
          <li key={`${item.kind}:${item.id}`}>
            <Link href={pendingApprovalHref(portal, item)} prefetch>
              <span className="dash-approvals__title">
                {pendingApprovalTitle(item, ar)}
              </span>
              <span className="dash-approvals__ref" dir="ltr">
                {item.reference}
              </span>
              <span className="dash-approvals__meta">
                {[
                  ar ? item.propertyNameAr : item.propertyNameEn || item.propertyNameAr,
                  item.unitCode,
                  item.party,
                  item.fromOn,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {pendingApprovalAmount(item, ar ? 'ar' : 'en') ? (
                <strong className="dash-approvals__meta">
                  {pendingApprovalAmount(item, ar ? 'ar' : 'en')}
                </strong>
              ) : null}
              <em className="dash-approvals__open">{openLabel}</em>
            </Link>
          </li>
        ))}
      </ul>
      {data.total > 6 ? (
        <p className="dash-section-hint">{moreLabel(data.total - 6)}</p>
      ) : null}
    </section>
  );
}
