'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from '@/i18n/navigation';
import {
  formatOmr,
  remainingParts,
  type ResolvedAuction,
} from '@/lib/auctions-catalogue';

export function AuctionDetailClient({
  locale,
  auction: initial,
}: {
  locale: string;
  auction: ResolvedAuction;
}) {
  const ar = locale !== 'en';
  const [auction, setAuction] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [amount, setAmount] = useState(String(initial.currentBid + 500));
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const parts = useMemo(() => {
    const target = auction.status === 'upcoming' ? auction.startTime : auction.endTime;
    return remainingParts(target, now);
  }, [auction.endTime, auction.startTime, auction.status, now]);

  const canBid = auction.status === 'active' && !parts.ended;

  async function submitBid(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/public/auctions/${auction.id}/bids`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          amount: Number(amount),
          bidderName: name.trim() || (ar ? 'مزايد' : 'Bidder'),
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        auction?: ResolvedAuction;
      };
      if (!res.ok || !json.ok || !json.auction) {
        const err = json.error;
        setMessage(
          err === 'bid_too_low'
            ? ar
              ? 'المبلغ أقل من الحد الأدنى.'
              : 'Bid is below the minimum.'
            : ar
              ? 'تعذّر تسجيل المزايدة.'
              : 'Could not place the bid.',
        );
        return;
      }
      setAuction(json.auction);
      setAmount(String(json.auction.currentBid + 500));
      setMessage(ar ? 'تم تسجيل مزايدتك.' : 'Your bid was recorded.');
    } catch {
      setMessage(ar ? 'تعذّر الاتصال بالخادم.' : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ap-detail">
      <div>
        <div className="ap-detail__media">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={auction.image} alt="" />
        </div>
        <div className="ap-panel" style={{ marginTop: '1rem' }}>
          <h2>{ar ? 'الوصف' : 'Description'}</h2>
          <p className="ap-card__meta">{ar ? auction.descriptionAr : auction.descriptionEn}</p>
          <p className="ap-card__meta" style={{ marginTop: '0.75rem' }}>
            {(ar ? auction.featuresAr : auction.featuresEn).join(' · ')}
          </p>
          <p className="ap-card__meta">
            {auction.area} m²
            {auction.bedrooms > 0
              ? ` · ${auction.bedrooms} ${ar ? 'غرف' : 'beds'} · ${auction.bathrooms} ${ar ? 'حمامات' : 'baths'}`
              : null}
          </p>
        </div>
      </div>

      <aside className="ap-panel">
        <p className="ap-card__meta">{ar ? auction.locationAr : auction.locationEn}</p>
        <h2 style={{ marginTop: '0.35rem' }}>{ar ? auction.titleAr : auction.titleEn}</h2>
        <p className="ap-card__price">
          {ar ? 'المزايدة الحالية' : 'Current bid'}: {formatOmr(auction.currentBid, ar ? 'ar' : 'en')}
        </p>
        <p className="ap-card__meta">
          {ar ? 'السعر الابتدائي' : 'Starting'}: {formatOmr(auction.startingPrice, ar ? 'ar' : 'en')}
        </p>

        <div className="ap-countdown" aria-live="polite">
          <div>
            <strong>{parts.days}</strong>
            <span>{ar ? 'يوم' : 'days'}</span>
          </div>
          <div>
            <strong>{parts.hours}</strong>
            <span>{ar ? 'ساعة' : 'hours'}</span>
          </div>
          <div>
            <strong>{parts.minutes}</strong>
            <span>{ar ? 'دقيقة' : 'min'}</span>
          </div>
          <div>
            <strong>{parts.seconds}</strong>
            <span>{ar ? 'ثانية' : 'sec'}</span>
          </div>
        </div>
        <p className="ap-card__meta">
          {auction.status === 'upcoming'
            ? ar
              ? 'العدّ التنازلي لبدء المزاد'
              : 'Countdown to auction start'
            : auction.status === 'ended'
              ? ar
                ? 'انتهى هذا المزاد'
                : 'This auction has ended'
              : ar
                ? 'العدّ التنازلي لنهاية المزاد'
                : 'Countdown to auction end'}
        </p>

        {canBid ? (
          <form className="ap-bid-form" onSubmit={submitBid}>
            <label>
              {ar ? 'اسم المزايد' : 'Bidder name'}
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </label>
            <label>
              {ar ? 'مبلغ المزايدة (ر.ع)' : 'Bid amount (OMR)'}
              <input
                type="number"
                min={auction.currentBid + 1}
                step={100}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </label>
            <button className="button button--gold" type="submit" disabled={busy}>
              {busy ? (ar ? 'جاري التسجيل…' : 'Submitting…') : ar ? 'قدّم مزايدة' : 'Place bid'}
            </button>
          </form>
        ) : (
          <p className="ap-card__meta" style={{ marginTop: '0.75rem' }}>
            {ar ? 'المزايدة غير متاحة حالياً لهذا العرض.' : 'Bidding is not available for this listing right now.'}
          </p>
        )}

        {message ? <p className="ap-card__meta">{message}</p> : null}

        {auction.bids.length > 0 ? (
          <>
            <h2 style={{ marginTop: '1rem' }}>{ar ? 'سجل المزايدات' : 'Bid history'}</h2>
            <ul className="ap-bid-list">
              {auction.bids.slice(0, 8).map((bid) => (
                <li key={bid.id}>
                  <span>{bid.bidderName}</span>
                  <strong>{formatOmr(bid.amount, ar ? 'ar' : 'en')}</strong>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <div style={{ marginTop: '1rem' }}>
          <Link className="button button--secondary button--small" href="/auctions">
            {ar ? '← كل المزادات' : '← All auctions'}
          </Link>
        </div>
      </aside>
    </div>
  );
}
