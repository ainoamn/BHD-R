'use client';

import { useEffect, useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import {
  formatOmr,
  remainingParts,
  type ResolvedAuction,
  type AuctionStatus,
} from '@/lib/auctions-catalogue';

const STATUS_FILTERS: { id: 'all' | AuctionStatus; ar: string; en: string }[] = [
  { id: 'all', ar: 'الكل', en: 'All' },
  { id: 'active', ar: 'نشط', en: 'Live' },
  { id: 'upcoming', ar: 'قادم', en: 'Upcoming' },
  { id: 'ended', ar: 'منتهٍ', en: 'Ended' },
];

function timerLabel(auction: ResolvedAuction, ar: boolean) {
  if (auction.status === 'upcoming') {
    const p = remainingParts(auction.startTime);
    return ar ? `يبدأ خلال ${p.days}ي ${p.hours}س` : `Starts in ${p.days}d ${p.hours}h`;
  }
  if (auction.status === 'ended') return ar ? 'انتهى' : 'Ended';
  const p = remainingParts(auction.endTime);
  return ar
    ? `متبقي ${p.days}ي ${p.hours}س ${p.minutes}د`
    : `${p.days}d ${p.hours}h ${p.minutes}m left`;
}

function statusClass(status: AuctionStatus) {
  if (status === 'ended') return 'ap-row__status is-ended';
  if (status === 'upcoming') return 'ap-row__status is-upcoming';
  return 'ap-row__status';
}

function statusLabel(status: AuctionStatus, ar: boolean, featured?: boolean) {
  if (featured && status === 'active') return ar ? 'مميز · نشط' : 'Featured · Live';
  if (status === 'active') return ar ? 'نشط' : 'Live';
  if (status === 'upcoming') return ar ? 'قادم' : 'Upcoming';
  return ar ? 'منتهٍ' : 'Ended';
}

export function AuctionsBrowse({
  locale,
  auctions,
  initialStatus = 'all',
}: {
  locale: string;
  auctions: ResolvedAuction[];
  initialStatus?: 'all' | AuctionStatus;
}) {
  const ar = locale !== 'en';
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | AuctionStatus>(initialStatus);

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return auctions
      .filter((a) => (status === 'all' ? true : a.status === status))
      .filter((a) => {
        if (!needle) return true;
        const hay = `${a.titleAr} ${a.titleEn} ${a.locationAr} ${a.locationEn}`.toLowerCase();
        return hay.includes(needle);
      })
      .sort((a, b) => {
        const rank = { active: 0, upcoming: 1, ended: 2 } as const;
        return rank[a.status] - rank[b.status];
      });
  }, [auctions, q, status]);

  return (
    <div>
      <div className="ap-tools">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={ar ? 'ابحث عن عقار أو موقع…' : 'Search property or location…'}
          aria-label={ar ? 'بحث المزادات' : 'Search auctions'}
        />
        <div className="ap-seg" role="group" aria-label={ar ? 'حالة المزاد' : 'Auction status'}>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={status === f.id ? 'is-active' : undefined}
              onClick={() => setStatus(f.id)}
            >
              {ar ? f.ar : f.en}
            </button>
          ))}
        </div>
      </div>

      <p className="ap-count">
        {ar ? `وجدنا ${filtered.length} مزاداً` : `${filtered.length} auctions`}
      </p>

      {filtered.length === 0 ? (
        <p className="ap-empty">{ar ? 'لا توجد مزادات مطابقة.' : 'No matching auctions.'}</p>
      ) : (
        <div className="ap-list">
          {filtered.map((auction) => (
            <Link key={auction.id} href={`/auctions/${auction.id}`} className="ap-row" prefetch>
              <div className="ap-row__media">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={auction.image} alt="" loading="lazy" />
              </div>
              <div className="ap-row__main">
                <span className={statusClass(auction.status)}>
                  {statusLabel(auction.status, ar, auction.featured)}
                </span>
                <h3>{ar ? auction.titleAr : auction.titleEn}</h3>
                <p className="ap-row__meta">{ar ? auction.locationAr : auction.locationEn}</p>
              </div>
              <div className="ap-row__side">
                <p className="ap-row__price">{formatOmr(auction.currentBid, ar ? 'ar' : 'en')}</p>
                <p className="ap-row__timer">{timerLabel(auction, ar)}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
