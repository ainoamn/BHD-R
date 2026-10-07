'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const BOTTOM_TOLERANCE_PX = 8;

/** Terms list that reveals the acceptance checkbox only after the reader scrolls to the end. */
export function TermsAcceptance({
  ar,
  lines,
  accepted,
  onAcceptedChange,
  resetKey,
  id = 'booking-terms',
}: {
  ar: boolean;
  lines: string[];
  accepted: boolean;
  onAcceptedChange: (accepted: boolean) => void;
  resetKey: string;
  id?: string;
}) {
  const listRef = useRef<HTMLOListElement | null>(null);
  const [reachedEnd, setReachedEnd] = useState(false);

  const checkEnd = useCallback(() => {
    const node = listRef.current;
    if (!node) return;
    if (node.scrollHeight - node.scrollTop - node.clientHeight <= BOTTOM_TOLERANCE_PX) {
      setReachedEnd(true);
    }
  }, []);

  useEffect(() => {
    setReachedEnd(false);
    const node = listRef.current;
    if (node) node.scrollTop = 0;
    const frame = window.requestAnimationFrame(checkEnd);
    return () => window.cancelAnimationFrame(frame);
  }, [resetKey, checkEnd]);

  useEffect(() => {
    const node = listRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => checkEnd());
    observer.observe(node);
    return () => observer.disconnect();
  }, [checkEnd]);

  return (
    <div className="terms-acceptance">
      <ol
        ref={listRef}
        id={id}
        className="lease-checkout__terms"
        tabIndex={0}
        aria-label={ar ? 'الشروط والأحكام' : 'Terms and conditions'}
        onScroll={checkEnd}
      >
        {lines.map((line, index) => (
          <li key={`${index}-${line.slice(0, 24)}`}>{line}</li>
        ))}
      </ol>
      {reachedEnd ? (
        <label className="checkbox-row lease-checkout__accept">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => onAcceptedChange(event.target.checked)}
          />
          <span>
            {ar
              ? 'أقر بأنني قرأت الشروط والأحكام أعلاه وأوافق عليها.'
              : 'I confirm I have read and agree to the terms above.'}
          </span>
        </label>
      ) : (
        <p className="terms-acceptance__hint" role="status">
          {ar
            ? '↓ مرّر إلى أسفل الشروط والأحكام حتى النهاية لإظهار زر الموافقة.'
            : '↓ Scroll to the end of the terms to show the acceptance checkbox.'}
        </p>
      )}
    </div>
  );
}
