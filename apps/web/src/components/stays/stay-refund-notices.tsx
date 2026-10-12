'use client';

import { useEffect, useRef, useState } from 'react';
import type { RefundNotice } from '@/lib/stay-deposit-refund';

const seenKey = (referenceCode: string) => `bhd-refund-seen:${referenceCode}`;

function readSeen(referenceCode: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(seenKey(referenceCode)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The guest's refund notices (request received, host decision, transfer). A host step the
 * guest has not seen yet is marked new and announced once; live sync brings new ones in.
 */
export function StayRefundNotices({
  notices,
  referenceCode,
  ar,
}: {
  notices: RefundNotice[];
  referenceCode: string;
  ar: boolean;
}) {
  const [fresh, setFresh] = useState<string[]>([]);
  const [toast, setToast] = useState<RefundNotice | null>(null);
  const ids = notices.map((notice) => notice.id).join('|');
  const checked = useRef<{ key: string; unseen: RefundNotice[] } | null>(null);

  useEffect(() => {
    const key = `${referenceCode}:${ids}`;
    if (checked.current?.key !== key) {
      const seen = new Set(readSeen(referenceCode));
      checked.current = { key, unseen: notices.filter((notice) => !seen.has(notice.id)) };
    }
    const { unseen } = checked.current;
    setFresh(unseen.map((notice) => notice.id));
    setToast(unseen.find((notice) => notice.kind !== 'requested') ?? null);
    try {
      localStorage.setItem(
        seenKey(referenceCode),
        JSON.stringify(notices.map((notice) => notice.id)),
      );
    } catch {
      // Private mode: notices still show, only the "new" mark is not remembered.
    }
  }, [ids, referenceCode]);

  if (!notices.length) return null;

  return (
    <>
      {toast ? (
        <div
          className={`stay-refund-toast stay-refund-toast--${toast.kind}`}
          role="status"
          aria-live="polite"
        >
          <div>
            <strong>{toast.title}</strong>
            <p>{toast.body}</p>
          </div>
          <button
            type="button"
            className="stay-refund-toast__close"
            aria-label={ar ? 'إغلاق' : 'Close'}
            onClick={() => setToast(null)}
          >
            ×
          </button>
        </div>
      ) : null}
      <section className="stay-refund-notices" aria-labelledby="stay-refund-notices-title">
        <h2 id="stay-refund-notices-title">
          {ar ? 'إشعارات استرداد التأمين' : 'Deposit refund notices'}
        </h2>
        <ol>
          {notices.map((notice) => (
            <li
              key={notice.id}
              className={`stay-refund-notices__item stay-refund-notices__item--${notice.kind}`}
            >
              <div className="stay-refund-notices__head">
                <strong>{notice.title}</strong>
                {fresh.includes(notice.id) ? (
                  <span className="stay-refund-notices__new">{ar ? 'جديد' : 'New'}</span>
                ) : null}
              </div>
              <p>{notice.body}</p>
              <time>{notice.at}</time>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
