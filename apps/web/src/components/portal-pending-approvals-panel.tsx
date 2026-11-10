'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { ContractKindChip, contractKindTone } from '@/components/contract-kind-chip';
import {
  PENDING_APPROVALS_CHANGED_EVENT,
  pendingApprovalAmount,
  pendingApprovalHref,
  pendingApprovalTitle,
  type PendingApprovals,
} from '@/lib/pending-approvals-shared';
import type { PortalRole } from '@/lib/types';

const PREVIEW_ROWS = 5;

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
  /** Template with `{count}` — must be a string (server→client safe). */
  moreLabel,
  allHref,
  allLabel,
}: {
  portal: PortalRole;
  locale: string;
  initial: PendingApprovals;
  title: string;
  hint: string;
  openLabel: string;
  moreLabel: string;
  allHref?: string;
  allLabel?: string;
}) {
  const ar = locale === 'ar';
  const [data, setData] = useState<PendingApprovals>(initial);
  const [expanded, setExpanded] = useState(false);

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

  const hiddenCount = Math.max(0, data.items.length - PREVIEW_ROWS);
  const visible = expanded ? data.items : data.items.slice(0, PREVIEW_ROWS);
  const moreText = hiddenCount > 0 ? moreLabel.replace('{count}', String(hiddenCount)) : null;

  return (
    <section id="pending-approvals" className="dash-approvals dash-approvals--rows" aria-label={title}>
      <div className="dash-section-head dash-section-head--compact">
        <h2>
          {title}
          <span className="dash-approvals__count">{data.total}</span>
        </h2>
        <p className="dash-section-hint">{hint}</p>
      </div>
      <ul className="dash-approvals__rows">
        {visible.map((item) => {
          const kindTone =
            item.kind === 'contract' || item.kind === 'renewal_term'
              ? contractKindTone(
                  item.contractKind ?? (item.kind === 'renewal_term' ? 'renewal' : 'initial'),
                )
              : null;
          const linkTone =
            kindTone === 'renewal'
              ? 'dash-approvals__row--renewal'
              : kindTone === 'new'
                ? 'dash-approvals__row--new'
                : '';
          const amount = pendingApprovalAmount(item, ar ? 'ar' : 'en');
          const meta = [
            ar ? item.propertyNameAr : item.propertyNameEn || item.propertyNameAr,
            item.unitCode,
            item.party,
            item.fromOn,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={`${item.kind}:${item.id}`}>
              <Link
                href={pendingApprovalHref(portal, item)}
                prefetch
                className={`dash-approvals__row ${linkTone}`.trim()}
              >
                <span className="dash-approvals__row-main">
                  <span className="dash-approvals__title">
                    {kindTone === 'new' || kindTone === 'renewal' ? (
                      <ContractKindChip
                        kind={item.contractKind ?? (kindTone === 'renewal' ? 'renewal' : 'initial')}
                        ar={ar}
                      />
                    ) : null}{' '}
                    {pendingApprovalTitle(item, ar)}
                  </span>
                  <span className="dash-approvals__meta">{meta}</span>
                </span>
                <span className="dash-approvals__row-side">
                  <span className="dash-approvals__ref" dir="ltr">
                    {item.reference}
                  </span>
                  {amount ? <strong className="dash-approvals__amount">{amount}</strong> : null}
                  <em className="dash-approvals__open">{openLabel}</em>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {moreText || allHref ? (
        <div className="dash-approvals__footer">
          {moreText ? (
            <button
              type="button"
              className="dash-approvals__expand"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
            >
              {expanded
                ? ar
                  ? 'عرض أقل'
                  : 'Show less'
                : moreText}
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
    </section>
  );
}
