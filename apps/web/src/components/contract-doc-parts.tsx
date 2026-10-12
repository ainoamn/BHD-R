import { Amiri } from 'next/font/google';
import type { ReactNode } from 'react';
import type { TermsLetterhead } from '@/lib/booking-terms';

/** Contract typeface; contracts, annexes and invoices share it (see the documents standard). */
export const contractSerif = Amiri({
  subsets: ['arabic', 'latin'],
  weight: ['400', '700'],
  display: 'swap',
  variable: '--font-contract',
});

export const BRAND_LOGO = '/brand/bhd-official-symbol.svg';

/** [Arabic, English] — documents print both. */
export type Pair = readonly [string, string];

/** Empty field: a dotted line to fill in by hand, like a printed form. */
function Value({ children }: { children: ReactNode }) {
  const empty = children === null || children === undefined || children === '';
  return empty ? <span className="contract-doc__blank" aria-label="—" /> : <>{children}</>;
}

export function ltr(value: string | null | undefined) {
  return value ? <bdi dir="ltr">{value}</bdi> : null;
}

/**
 * Bilingual building blocks. The reader's language comes first; side-by-side
 * text keeps Arabic on the right and English on the left in both layouts.
 */
export function contractKit(ar: boolean) {
  const order = (arNode: ReactNode, enNode: ReactNode) =>
    ar ? [arNode, enNode] : [enNode, arNode];
  const bi = (value: Pair | string | null | undefined): ReactNode => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value || null;
    const [arText, enText] = value;
    if (!arText || !enText || arText === enText) return arText || enText || null;
    return (
      <span className="contract-doc__bi">
        {order(
          <span key="ar" className="contract-doc__ar" lang="ar" dir="rtl">
            {arText}
          </span>,
          <span key="en" className="contract-doc__en" lang="en" dir="ltr">
            {enText}
          </span>,
        )}
      </span>
    );
  };
  const row = (term: Pair, value: ReactNode, wide = false) => (
    <div className={`contract-doc__row${wide ? ' contract-doc__row--wide' : ''}`}>
      <dt>{bi(term)}</dt>
      <dd>
        <Value>{value}</Value>
      </dd>
    </div>
  );
  const para = (arText: string, enText: string, className = '') => (
    <div className={`contract-doc__para${className ? ` ${className}` : ''}`}>
      {order(
        <p key="ar" lang="ar" dir="rtl">
          {arText}
        </p>,
        <p key="en" lang="en" dir="ltr">
          {enText}
        </p>,
      )}
    </div>
  );
  return { ar, order, bi, row, para };
}

/** Company name and address in both languages around the logo, repeated on every printed page. */
export function DocLetterhead({
  letterhead,
  fallbackName,
}: {
  letterhead: TermsLetterhead | null;
  fallbackName: string;
}) {
  const companyAr = letterhead?.nameAr || fallbackName;
  const companyEn = letterhead?.nameEn || fallbackName;
  return (
    <header className="contract-doc__letterhead" dir="rtl">
      <div className="contract-doc__lh-side" dir="rtl" lang="ar">
        <strong>{companyAr}</strong>
        {letterhead?.addressAr ? <span>{letterhead.addressAr}</span> : null}
      </div>
      <div className="contract-doc__lh-logo">
        <img src={letterhead?.logoDataUrl || BRAND_LOGO} alt={companyEn} />
      </div>
      <div className="contract-doc__lh-side" dir="ltr" lang="en">
        <strong>{companyEn}</strong>
        {letterhead?.addressEn ? <span>{letterhead.addressEn}</span> : null}
      </div>
    </header>
  );
}
