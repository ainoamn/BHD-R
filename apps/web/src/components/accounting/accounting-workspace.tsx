'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type FinDashMetricTone = 'revenue' | 'expense' | 'profit' | 'cash';

export type AccountingWorkspaceMetric = {
  key: string;
  label: string;
  value: string;
  tone: FinDashMetricTone;
  badge?: string;
  icon?: string;
  onClick?: () => void;
};

export type AccountingWorkspaceStat = {
  key: string;
  label: string;
  value: string;
};

type SectionProps = {
  title?: string;
  hint?: ReactNode;
  actions?: ReactNode | null;
  children: ReactNode;
  className?: string;
};

/** White card section matching the summary `fin-dash__section` chrome. */
export function AccountingWorkspaceSection({
  title,
  hint,
  actions,
  children,
  className,
}: SectionProps) {
  const head = title || hint || actions;
  return (
    <section
      className={['fin-dash__section', 'fin-dash__section--workspace', className]
        .filter(Boolean)
        .join(' ')}
    >
      {head ? (
        <header className="fin-dash__section-head">
          <div className="fin-dash__section-copy">
            {title ? <h2>{title}</h2> : null}
            {hint ? <div className="fin-dash__section-hint">{hint}</div> : null}
          </div>
          {actions ? <div className="fin-dash__section-actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="fin-dash__section-body">{children}</div>
    </section>
  );
}

type WorkspaceProps = {
  title: string;
  hint?: ReactNode;
  actions?: ReactNode | null;
  metrics?: AccountingWorkspaceMetric[] | undefined;
  stats?: AccountingWorkspaceStat[] | undefined;
  /** Content rendered between stats and the primary section (e.g. alerts). */
  beforeSection?: ReactNode | null;
  /** Extra sections after the primary body (e.g. secondary tables). */
  afterSection?: ReactNode | null;
  children: ReactNode;
  className?: string;
};

function MetricCard({ metric }: { metric: AccountingWorkspaceMetric }) {
  const className = `fin-dash__metric fin-dash__metric--${metric.tone}`;
  const inner = (
    <>
      <div className="fin-dash__metric-top">
        <span className="fin-dash__metric-icon" aria-hidden="true">
          {metric.icon ?? '◆'}
        </span>
        {metric.badge ? <span className="fin-dash__metric-badge">{metric.badge}</span> : null}
      </div>
      <p className="fin-dash__metric-label">{metric.label}</p>
      <p className="fin-dash__metric-value">{metric.value}</p>
    </>
  );
  if (metric.onClick) {
    const props: ButtonHTMLAttributes<HTMLButtonElement> = {
      type: 'button',
      className,
      onClick: metric.onClick,
    };
    return <button {...props}>{inner}</button>;
  }
  return <div className={className}>{inner}</div>;
}

/**
 * Shared shell for every accounting tab besides الملخص: same spacing, optional
 * gradient metrics + secondary stats, then a white section for the working surface.
 */
export function AccountingWorkspace({
  title,
  hint,
  actions,
  metrics,
  stats,
  beforeSection,
  afterSection,
  children,
  className,
}: WorkspaceProps) {
  const metricCols = metrics?.length ?? 0;
  const statCols = stats?.length ?? 0;
  return (
    <div className={['fin-dash', 'fin-dash--workspace', className].filter(Boolean).join(' ')}>
      {metricCols > 0 ? (
        <div
          className={[
            'fin-dash__metrics',
            metricCols !== 4 ? `fin-dash__metrics--${metricCols}` : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {metrics!.map((metric) => (
            <MetricCard key={metric.key} metric={metric} />
          ))}
        </div>
      ) : null}
      {statCols > 0 ? (
        <div
          className={[
            'fin-dash__secondary',
            statCols !== 4 ? `fin-dash__secondary--${statCols}` : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {stats!.map((stat) => (
            <div key={stat.key} className="fin-dash__stat">
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </div>
          ))}
        </div>
      ) : null}
      {beforeSection}
      <AccountingWorkspaceSection title={title} hint={hint} actions={actions}>
        {children}
      </AccountingWorkspaceSection>
      {afterSection}
    </div>
  );
}

export function FinDashEmpty({ children }: { children: ReactNode }) {
  return <p className="fin-dash__empty">{children}</p>;
}
