'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TermsDocument } from '@/components/terms-document';
import { TermsPrintButton } from '@/components/terms-print-button';
import type { NumberedTermsBlock, TermsLetterhead } from '@/lib/booking-terms';

const BOTTOM_TOLERANCE_PX = 8;

/** Terms document that reveals the acceptance checkbox only after the reader scrolls to the end. */
export function TermsAcceptance({
  ar,
  blocks,
  letterhead,
  printTitle,
  accepted,
  onAcceptedChange,
  resetKey,
  id = 'booking-terms',
}: {
  ar: boolean;
  blocks: NumberedTermsBlock[];
  letterhead?: TermsLetterhead | null;
  printTitle: { ar: string; en: string };
  accepted: boolean;
  onAcceptedChange: (accepted: boolean) => void;
  resetKey: string;
  id?: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [reachedEnd, setReachedEnd] = useState(false);

  const checkEnd = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    if (node.scrollHeight - node.scrollTop - node.clientHeight <= BOTTOM_TOLERANCE_PX) {
      setReachedEnd(true);
    }
  }, []);

  useEffect(() => {
    setReachedEnd(false);
    const node = scrollRef.current;
    if (node) node.scrollTop = 0;
    const frame = window.requestAnimationFrame(checkEnd);
    return () => window.cancelAnimationFrame(frame);
  }, [resetKey, checkEnd]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => checkEnd());
    observer.observe(node);
    return () => observer.disconnect();
  }, [checkEnd]);

  return (
    <div className="terms-acceptance">
      <div className="terms-acceptance__toolbar">
        <TermsPrintButton
          ar={ar}
          blocks={blocks}
          letterhead={letterhead}
          titleAr={printTitle.ar}
          titleEn={printTitle.en}
        />
      </div>
      <div
        ref={scrollRef}
        id={id}
        className="terms-acceptance__scroll"
        tabIndex={0}
        role="region"
        aria-label={ar ? 'الشروط والأحكام' : 'Terms and conditions'}
        onScroll={checkEnd}
      >
        <TermsDocument blocks={blocks} />
      </div>
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
