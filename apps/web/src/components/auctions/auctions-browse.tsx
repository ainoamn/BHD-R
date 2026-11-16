'use client';

import { useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import {
  formatOmr,
  remainingParts,
  type ResolvedAuction,
  type AuctionStatus,
} from '@/lib/auctions-catalogue';

const STATUS_FILTERS: { id: 'all' | AuctionStatus; ar: string; en: string }[] = [
  { id: 'all', ar: 'الكل', en: 'All' },
  { id: 'active', ar: 'نشط', en: 'Active' },
  { id: 'upcoming', ar: 'قادم', en: 'Upcoming' },
  { id: 'ended', ar: 'منتهٍ', en: 'Ended' },
];

function timerLabel(auction: ResolvedAuction, ar: boolean) {
  if (auction.status === 'upcoming') {
    const p = remainingParts(auction.startTime);
    return ar
      ? `يبدأ خلال ${p.days}ي ${p.hours}س`
      : `Starts in ${p.days}d ${p.hours}h`;
  }
  if (auction.status === 'ended') return ar ? 'انتهى المزاد' : 'Auction ended';
  const p = remainingParts(auction.endTime);
  return ar
    ? `متبقي ${p.days}ي ${p.hours}س ${p.minutes}د`
    : `${p.days}d ${p.hours}h ${p.minutes}m left`;
}

function statusBadge(status: AuctionStatus, ar: boolean) {
  if (status === 'active') return ar ? 'نشط' : 'Live';
  if (status === 'upcoming') return ar ? 'قادم' : 'Upcoming';
  return ar ? 'منتهٍ' : 'Ended';
}

export function AuctionsBrowse({
  locale,
  auctions,
}: {
  locale: string;
  auctions: ResolvedAuction[];
}) {
  const ar = locale !== 'en';
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | AuctionStatus>('all');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return auctions
      .filter((a) => (status === 'all' ? true : a.status === status))
      .filter((a) => {
        if (!needle) return true;
        const hay = `${a.titleAr} ${a.titleEn} ${a.locationAr} ${a.locationEn}`.toLowerCase();
        return hay.includes(needle);
      });
  }, [auctions, q, status]);

  const groups: { key: AuctionStatus; ar: string; en: string; items: ResolvedAuction[] }[] = [
    {
      key: 'active',
      ar: 'المزادات النشطة',
      en: 'Active auctions',
      items: filtered.filter((a) => a.status === 'active'),
    },
    {
      key: 'upcoming',
      ar: 'المزادات القادمة',
      en: 'Upcoming auctions',
      items: filtered.filter((a) => a.status === 'upcoming'),
    },
    {
      key: 'ended',
      ar: 'المزادات المنتهية',
      en: 'Ended auctions',
      items: filtered.filter((a) => a.status === 'ended'),
    },
  ];

  return (
    <div>
      <div className="ap-filters">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={ar ? 'ابحث عن عقار أو موقع…' : 'Search property or location…'}
          aria-label={ar ? 'بحث المزادات' : 'Search auctions'}
        />
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={status === f.id ? 'ap-chip is-active' : 'ap-chip'}
            onClick={() => setStatus(f.id)}
          >
            {ar ? f.ar : f.en}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="ap-empty">{ar ? 'لا توجد مزادات مطابقة.' : 'No matching auctions.'}</p>
      ) : (
        groups.map((group) =>
          group.items.length === 0 ? null : (
            <section key={group.key}>
              <h2 className="ap-section-title">{ar ? group.ar : group.en}</h2>
              <div className="ap-grid">
                {group.items.map((auction) => (
                  <Link
                    key={auction.id}
                    href={`/auctions/${auction.id}`}
                    className="ap-card"
                    prefetch
                  >
                    <div className="ap-card__media">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={auction.image} alt="" loading="lazy" />
                      {auction.featured ? (
                        <span className="ap-card__badge ap-card__badge--featured">
                          {ar ? 'مميز' : 'Featured'}
                        </span>
                      ) : (
                        <span
                          className={
                            auction.status === 'ended'
                              ? 'ap-card__badge ap-card__badge--ended'
                              : 'ap-card__badge'
                          }
                        >
                          {statusBadge(auction.status, ar)}
                        </span>
                      )}
                      <div className="ap-card__timer">{timerLabel(auction, ar)}</div>
                    </div>
                    <div className="ap-card__body">
                      <h3>{ar ? auction.titleAr : auction.titleEn}</h3>
                      <p className="ap-card__meta">{ar ? auction.locationAr : auction.locationEn}</p>
                      <p className="ap-card__price">
                        {ar ? 'المزايدة الحالية: ' : 'Current bid: '}
                        {formatOmr(auction.currentBid, ar ? 'ar' : 'en')}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ),
        )
      )}
    </div>
  );
}
