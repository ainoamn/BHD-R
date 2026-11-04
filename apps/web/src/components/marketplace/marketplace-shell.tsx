import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';

export function MarketplaceShell({
  locale,
  kicker,
  title,
  lead,
  actions,
  children,
  band,
}: {
  locale: string;
  kicker: string;
  title: string;
  lead: string;
  actions?: ReactNode;
  children: ReactNode;
  band?: ReactNode;
}) {
  const ar = locale !== 'en';
  return (
    <main className="mkt">
      <section className="mkt-hero">
        <div className="container mkt-hero__inner">
          <span className="mkt-hero__kicker">{kicker}</span>
          <h1>{title}</h1>
          <p className="mkt-hero__lead">{lead}</p>
          {actions ? <div className="mkt-hero__actions">{actions}</div> : null}
          <nav aria-label={ar ? 'خدمات السوق' : 'Market services'} className="mkt-hero__actions">
            <Link className="button button--secondary button--small" href="/offices">
              {ar ? 'المكاتب' : 'Offices'}
            </Link>
            <Link className="button button--secondary button--small" href="/appraisers">
              {ar ? 'المثمّنون' : 'Appraisers'}
            </Link>
            <Link className="button button--secondary button--small" href="/insurance">
              {ar ? 'التأمين' : 'Insurance'}
            </Link>
            <Link className="button button--secondary button--small" href="/valuation">
              {ar ? 'طلب تثمين' : 'Valuation'}
            </Link>
          </nav>
        </div>
      </section>
      <div className="container" style={{ paddingTop: '1.25rem' }}>
        {children}
        {band}
      </div>
    </main>
  );
}
