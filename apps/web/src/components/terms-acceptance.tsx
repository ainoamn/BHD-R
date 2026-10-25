'use client';

import { useEffect, useRef, useState } from 'react';
import { TermsDocument } from '@/components/terms-document';
import { TermsPrintButton } from '@/components/terms-print-button';
import type { NumberedTermsBlock, TermsLetterhead } from '@/lib/booking-terms';

/**
 * Terms acceptance for booking checkouts.
 * Document stays collapsed until the guest opens it; the open CTA is a red
 * “must read” control. The acceptance checkbox is always available.
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
}: {
  ar: boolean;
  blocks: NumberedTermsBlock[];
  letterhead?: TermsLetterhead | null;
  printTitle: { ar: string; en: string };
  accepted: boolean;
  onAcceptedChange: (accepted: boolean) => void;
  resetKey: string;
  id?: string;
  /** @deprecated Always collapsed + openable; kept for call-site compatibility. */
  mode?: 'consent' | 'scroll';
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [termsOpen, setTermsOpen] = useState(false);

  useEffect(() => {
    setTermsOpen(false);
  }, [resetKey]);

  return (
    <div className="terms-acceptance terms-acceptance--consent">
      <div className="terms-acceptance__toolbar">
        <button
          type="button"
          className={
            termsOpen
              ? 'button button--quiet terms-acceptance__view'
              : 'button terms-acceptance__view terms-acceptance__view--required'
          }
          onClick={() => setTermsOpen((open) => !open)}
          aria-expanded={termsOpen}
          aria-controls={id}
        >
          {termsOpen
            ? ar
              ? 'إخفاء الشروط والأحكام'
              : 'Hide terms & conditions'
            : ar
              ? 'اقرأ الشروط والأحكام (إلزامي)'
              : 'Read terms & conditions (required)'}
        </button>
        <TermsPrintButton
          ar={ar}
          blocks={blocks}
          letterhead={letterhead}
          titleAr={printTitle.ar}
          titleEn={printTitle.en}
        />
      </div>

      {termsOpen ? (
        <div
          ref={scrollRef}
          id={id}
          className="terms-acceptance__scroll"
          tabIndex={0}
          role="region"
          aria-label={ar ? 'الشروط والأحكام' : 'Terms and conditions'}
        >
          <TermsDocument blocks={blocks} />
        </div>
      ) : null}

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
    </div>
  );
}
