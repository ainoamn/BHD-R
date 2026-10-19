'use client';

import { useCallback, useEffect, useState } from 'react';
import { PublicListingShare } from '@/components/public-listing-share';

const LIKES_KEY = 'bhd-r:listing-likes';
const FAVS_KEY = 'bhd-r:listing-favorites';

function readSet(key: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeSet(key: string, values: Set<string>) {
  window.localStorage.setItem(key, JSON.stringify([...values]));
}

/** Share + like + favorite for public listing/stay pages (likes & favorites are local). */
export function ListingEngagementBar({
  listingKey,
  path,
  title,
  description,
  locale,
}: {
  listingKey: string;
  path: string;
  title: string;
  description?: string | null;
  locale: 'ar' | 'en';
}) {
  const ar = locale === 'ar';
  const [liked, setLiked] = useState(false);
  const [favorited, setFavorited] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setLiked(readSet(LIKES_KEY).has(listingKey));
    setFavorited(readSet(FAVS_KEY).has(listingKey));
  }, [listingKey]);

  const flash = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2_200);
  }, []);

  const toggle = useCallback(
    (kind: 'like' | 'favorite') => {
      const key = kind === 'like' ? LIKES_KEY : FAVS_KEY;
      const next = readSet(key);
      const on = next.has(listingKey);
      if (on) next.delete(listingKey);
      else next.add(listingKey);
      writeSet(key, next);
      if (kind === 'like') {
        setLiked(!on);
        flash(
          !on
            ? ar
              ? 'أُضيف إعجابك.'
              : 'Liked.'
            : ar
              ? 'أُزيل الإعجاب.'
              : 'Like removed.',
        );
      } else {
        setFavorited(!on);
        flash(
          !on
            ? ar
              ? 'أُضيف إلى المفضلة على هذا الجهاز.'
              : 'Saved to favorites on this device.'
            : ar
              ? 'أُزيل من المفضلة.'
              : 'Removed from favorites.',
        );
      }
    },
    [ar, flash, listingKey],
  );

  return (
    <div className="listing-engagement" aria-label={ar ? 'مشاركة وتفاعل' : 'Share and save'}>
      <PublicListingShare
        path={path}
        title={title}
        description={description}
        locale={locale}
      />
      <div className="listing-engagement__actions">
        <button
          type="button"
          className={`listing-engagement__btn${liked ? ' is-on' : ''}`}
          aria-pressed={liked}
          onClick={() => toggle('like')}
        >
          <span aria-hidden="true">{liked ? '♥' : '♡'}</span>
          {ar ? 'إعجاب' : 'Like'}
        </button>
        <button
          type="button"
          className={`listing-engagement__btn${favorited ? ' is-on' : ''}`}
          aria-pressed={favorited}
          onClick={() => toggle('favorite')}
        >
          <span aria-hidden="true">{favorited ? '★' : '☆'}</span>
          {ar ? 'مفضلة' : 'Favorite'}
        </button>
      </div>
      {notice ? (
        <p className="listing-engagement__notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
