'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TermsDocument } from '@/components/terms-document';
import { TermsPrintButton } from '@/components/terms-print-button';
import type { NumberedTermsBlock, TermsLetterhead } from '@/lib/booking-terms';

const BOTTOM_TOLERANCE_PX = 8;

/**
 * Terms acceptance for booking checkouts.
 * - `consent` (default): checkbox always available; optional “view terms” expands the document.
 * - `scroll`: legacy lease flow — checkbox only after scrolling to the end.
 */
export function TermsAcceptance({
  ar,
  blocks,
  letterhead,
  printTitle,
  accepted,
  onAcceptedChange,
  resetKey,
  id = 'booking-terms',
  mode = 'consent',
}: {
  ar: boolean;
  blocks: NumberedTermsBlock[];
  letterhead?: TermsLetterhead | null;
  printTitle: { ar: string; en: string };
  accepted: boolean;
  onAcceptedChange: (accepted: boolean) => void;
  resetKey: string;
  id?: string;
  mode?: 'consent' | 'scroll';
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [reachedEnd, setReachedEnd] = useState(mode === 'consent');
  const [termsOpen, setTermsOpen] = useState(false);

  const checkEnd = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    if (node.scrollHeight - node.scrollTop - node.clientHeight <= BOTTOM_TOLERANCE_PX) {
      setReachedEnd(true);
    }
  }, []);

  useEffect(() => {
    if (mode === 'consent') {
      setReachedEnd(true);
      return;
    }
    setReachedEnd(false);
    const node = scrollRef.current;
    if (node) node.scrollTop = 0;
    const frame = window.requestAnimationFrame(checkEnd);
    return () => window.cancelAnimationFrame(frame);
  }, [resetKey, checkEnd, mode]);

  useEffect(() => {
    if (mode !== 'scroll') return;
    const node = scrollRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => checkEnd());
    observer.observe(node);
    return () => observer.disconnect();
  }, [checkEnd, mode, termsOpen]);

  const showDocument = mode === 'scroll' || termsOpen;
  const canAccept = mode === 'consent' || reachedEnd;

  return (
    <div className={`terms-acceptance terms-acceptance--${mode}`}>
      <div className="terms-acceptance__toolbar">
        {mode === 'consent' ? (
          <button
            type="button"
            className="button button--quiet terms-acceptance__view"
            onClick={() => setTermsOpen((open) => !open)}
            aria-expanded={termsOpen}
            aria-controls={id}
          >
            {termsOpen
              ? ar
                ? 'إخفاء الشروط والأحكام'
                : 'Hide terms & conditions'
              : ar
                ? 'اطّلع على الشروط والأحكام'
                : 'View terms & conditions'}
          </button>
        ) : null}
        <TermsPrintButton
          ar={ar}
          blocks={blocks}
          letterhead={letterhead}
          titleAr={printTitle.ar}
          titleEn={printTitle.en}
        />
      </div>

      {showDocument ? (
        <div
          ref={scrollRef}
          id={id}
          className="terms-acceptance__scroll"
          tabIndex={0}
          role="region"
          aria-label={ar ? 'الشروط والأحكام' : 'Terms and conditions'}
          onScroll={mode === 'scroll' ? checkEnd : undefined}
        >
          <TermsDocument blocks={blocks} />
        </div>
      ) : null}

      {canAccept ? (
        <label className="checkbox-row lease-checkout__accept terms-acceptance__consent">
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
