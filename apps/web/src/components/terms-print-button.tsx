'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  TermsDocument,
  TermsLetterheadFooter,
  TermsLetterheadHeader,
} from '@/components/terms-document';
import type { NumberedTermsBlock, TermsLetterhead } from '@/lib/booking-terms';

const PRINTING_CLASS = 'printing-terms';

/** Prints only the terms: company logo and name on top, the numbered terms, then the company address. */
export function TermsPrintButton({
  ar,
  blocks,
  letterhead,
  titleAr,
  titleEn,
  className = 'button button--quiet',
}: {
  ar: boolean;
  blocks: readonly NumberedTermsBlock[];
  letterhead: TermsLetterhead | null | undefined;
  titleAr: string;
  titleEn: string;
  className?: string;
}) {
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!printing) return;
    const body = document.body;
    const finish = () => {
      body.classList.remove(PRINTING_CLASS);
      setPrinting(false);
    };
    body.classList.add(PRINTING_CLASS);
    window.addEventListener('afterprint', finish, { once: true });
    const frame = window.requestAnimationFrame(() => window.print());
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('afterprint', finish);
      body.classList.remove(PRINTING_CLASS);
    };
  }, [printing]);

  return (
    <>
      <button type="button" className={className} onClick={() => setPrinting(true)}>
        {ar ? 'طباعة الشروط والأحكام' : 'Print terms & conditions'}
      </button>
      {printing
        ? createPortal(
            <div className="terms-print" aria-hidden="true">
              {letterhead ? <TermsLetterheadHeader letterhead={letterhead} /> : null}
              <div className="terms-print__title">
                <span dir="ltr" lang="en">
                  {titleEn}
                </span>
                <span dir="rtl" lang="ar">
                  {titleAr}
                </span>
              </div>
              <TermsDocument blocks={blocks} />
              {letterhead ? <TermsLetterheadFooter letterhead={letterhead} /> : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
