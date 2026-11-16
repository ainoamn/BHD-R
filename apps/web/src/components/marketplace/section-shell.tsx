import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';

export type SectionTab = {
  href: string;
  ar: string;
  en: string;
  active?: boolean;
};

/**
 * Slim public shell for Auctions + Development — one brand signal, one title,
 * one line, section tabs, optional CTAs. No market-services chrome.
 */
export function SectionShell({
  locale,
  brand,
  title,
  lead,
  tabs,
  actions,
  children,
}: {
  locale: string;
  brand: string;
  title: string;
  lead: string;
  tabs: SectionTab[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  const ar = locale !== 'en';
  return (
    <main className="ap">
      <header className="ap-hero">
        <div className="container ap-hero__inner">
          <p className="ap-hero__brand">{brand}</p>
          <h1>{title}</h1>
          <p className="ap-hero__lead">{lead}</p>
          {actions ? <div className="ap-hero__actions">{actions}</div> : null}
        </div>
      </header>

      <div className="ap-toolbar sticky-search">
        <div className="container ap-toolbar__inner">
          <nav className="ap-tabs" aria-label={ar ? 'أقسام الصفحة' : 'Section pages'}>
            {tabs.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                prefetch
                scroll={false}
                className={tab.active ? 'ap-tabs__item is-active' : 'ap-tabs__item'}
              >
                {ar ? tab.ar : tab.en}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <div className="container ap-body">{children}</div>
    </main>
  );
}

export const AUCTION_TABS = (active: string): SectionTab[] =>
  [
    { href: '/auctions', ar: 'كل المزادات', en: 'All auctions' },
    { href: '/auctions?status=active', ar: 'الحالية', en: 'Live' },
    { href: '/auctions?status=upcoming', ar: 'قادمة', en: 'Upcoming' },
    { href: '/auctions/my', ar: 'مزاداتي', en: 'My auctions' },
    { href: '/auctions/new', ar: 'إنشاء مزاد', en: 'Create' },
  ].map((tab) => ({
    ...tab,
    active:
      active === 'all'
        ? tab.href === '/auctions'
        : active === 'active'
          ? tab.href.includes('status=active')
          : active === 'upcoming'
            ? tab.href.includes('status=upcoming')
            : active === 'my'
              ? tab.href === '/auctions/my'
              : active === 'new'
                ? tab.href === '/auctions/new'
                : false,
  }));

export const PROJECT_TABS = (active: string): SectionTab[] =>
  [
    { href: '/projects', ar: 'المشاريع', en: 'Projects' },
    { href: '/projects/opportunities', ar: 'الفرص', en: 'Opportunities' },
    { href: '/projects/financing', ar: 'التمويل', en: 'Financing' },
    { href: '/projects/partners', ar: 'الشركاء', en: 'Partners' },
  ].map((tab) => ({
    ...tab,
    active:
      active === 'projects'
        ? tab.href === '/projects'
        : active === 'opportunities'
          ? tab.href.includes('opportunities')
          : active === 'financing'
            ? tab.href.includes('financing')
            : active === 'partners'
              ? tab.href.includes('partners')
              : false,
  }));
