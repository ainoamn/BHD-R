'use client';

import type { ReactNode } from 'react';
import { SoftPortalLink as Link } from '@/components/soft-portal-link';

export type OpsAttentionTone = 'danger' | 'warning' | 'info' | 'approval' | 'neutral';

export type OpsAttentionItem = {
  key: string;
  title: string;
  reference?: string;
  meta?: string;
  href?: string;
  tone?: OpsAttentionTone;
  actionLabel?: string;
  count?: number | string;
};

function statusClass(tone: OpsAttentionTone | undefined) {
  switch (tone) {
    case 'danger':
      return 'ops-status ops-status--negative';
    case 'warning':
      return 'ops-status ops-status--warning';
    case 'approval':
      return 'ops-status ops-status--approval';
    case 'info':
      return 'ops-status ops-status--info';
    default:
      return 'ops-status ops-status--neutral';
  }
}

function toneLabel(tone: OpsAttentionTone | undefined, ar: boolean) {
  switch (tone) {
    case 'danger':
      return ar ? 'عاجل' : 'Urgent';
    case 'warning':
      return ar ? 'تنبيه' : 'Attention';
    case 'approval':
      return ar ? 'اعتماد' : 'Approval';
    case 'info':
      return ar ? 'معلومة' : 'Info';
    default:
      return ar ? 'تنبيه' : 'Notice';
  }
}

/** Polished attention cards matching owner contracts ops list. */
export function OpsAttentionList({
  items,
  ar,
  empty,
  labelledBy,
}: {
  items: OpsAttentionItem[];
  ar: boolean;
  empty?: ReactNode;
  labelledBy?: string;
}) {
  if (!items.length) {
    return empty ? <>{empty}</> : null;
  }
  return (
    <div className="ops-mobile-cards ops-attention-cards" aria-labelledby={labelledBy}>
      {items.map((item) => {
        const tone = item.tone ?? (item.actionLabel ? 'warning' : 'neutral');
        const body = (
          <>
            <div className="ops-mobile-card__head">
              <div className="ops-mobile-card__head-copy">
                <h3 className="ops-mobile-card__title">{item.title}</h3>
                {item.reference ? (
                  <p className="ops-mobile-card__serial" dir="ltr">
                    {item.reference}
                  </p>
                ) : null}
              </div>
              <span className={statusClass(tone)}>{toneLabel(tone, ar)}</span>
            </div>
            <dl className="ops-mobile-card__meta">
              {item.count != null ? (
                <div>
                  <dt>{ar ? 'العدد' : 'Count'}</dt>
                  <dd>
                    <bdi>{item.count}</bdi>
                  </dd>
                </div>
              ) : null}
              {item.meta ? (
                <div>
                  <dt>{ar ? 'التفاصيل' : 'Details'}</dt>
                  <dd>{item.meta}</dd>
                </div>
              ) : null}
            </dl>
            {item.href ? (
              <div className="ops-action-group">
                <span className="ops-action ops-action--primary">
                  {item.actionLabel ?? (ar ? 'عرض التفاصيل' : 'View details')}
                </span>
              </div>
            ) : null}
          </>
        );
        if (item.href) {
          return (
            <Link
              key={item.key}
              href={item.href}
              className={`ops-mobile-card ops-attention-card${tone === 'approval' ? ' ops-mobile-card--approval' : ''}${tone === 'danger' ? ' ops-attention-card--danger' : ''}`}
              prefetch
            >
              {body}
            </Link>
          );
        }
        return (
          <article key={item.key} className="ops-mobile-card ops-attention-card">
            {body}
          </article>
        );
      })}
    </div>
  );
}

/** Section chrome matching contracts ops panel. */
export function OpsAttentionSection({
  kicker,
  title,
  hint,
  ar,
  children,
  count,
}: {
  kicker?: string;
  title: string;
  hint?: string;
  ar: boolean;
  children: ReactNode;
  count?: number;
}) {
  return (
    <section className="ops-panel ops-attention-panel" aria-label={title}>
      <div className="ops-attention-panel__head">
        <div>
          {kicker ? <span className="ops-kicker">{kicker}</span> : null}
          <h2>{title}</h2>
          {hint ? <p className="ops-attention-panel__hint">{hint}</p> : null}
        </div>
        {typeof count === 'number' ? (
          <span className="ops-result-count">
            {count} {ar ? 'تنبيه' : count === 1 ? 'alert' : 'alerts'}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}
