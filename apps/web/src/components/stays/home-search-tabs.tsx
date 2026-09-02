'use client';

import { useState, type ReactNode } from 'react';

type TabId = 'rent' | 'sale' | 'daily';

export function HomeSearchTabs({
  locale,
  rentSearch,
  saleSearch,
  staySearch,
}: {
  locale: string;
  rentSearch: ReactNode;
  saleSearch: ReactNode;
  staySearch: ReactNode;
}) {
  const ar = locale === 'ar';
  const [tab, setTab] = useState<TabId>('daily');

  const labels: Record<TabId, string> = {
    daily: ar ? 'إقامة يومية' : 'Daily stay',
    rent: ar ? 'إيجار' : 'Rent',
    sale: ar ? 'بيع' : 'Sale',
  };

  const tabOrder: TabId[] = ['daily', 'rent', 'sale'];

  return (
    <div className="home-search-tabs">
      <div
        className="purpose-tabs home-search-tabs__list"
        role="tablist"
        aria-label={ar ? 'نوع البحث' : 'Search type'}
      >
        {tabOrder.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`home-search-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`home-search-panel-${id}`}
            className={tab === id ? 'purpose-tabs__item is-active' : 'purpose-tabs__item'}
            onClick={() => setTab(id)}
          >
            {labels[id]}
          </button>
        ))}
      </div>
      <div
        id="home-search-panel-rent"
        role="tabpanel"
        aria-labelledby="home-search-tab-rent"
        hidden={tab !== 'rent'}
      >
        {rentSearch}
      </div>
      <div
        id="home-search-panel-sale"
        role="tabpanel"
        aria-labelledby="home-search-tab-sale"
        hidden={tab !== 'sale'}
      >
        {saleSearch}
      </div>
      <div
        id="home-search-panel-daily"
        role="tabpanel"
        aria-labelledby="home-search-tab-daily"
        hidden={tab !== 'daily'}
      >
        {staySearch}
      </div>
    </div>
  );
}
