import type { NumberedTermsBlock, TermsLetterhead } from '@/lib/booking-terms';

function itemClass(block: NumberedTermsBlock): string {
  const classes = ['terms-doc__item', `terms-doc__item--${block.kind}`];
  if (block.platform) classes.push('terms-doc__item--platform');
  if (!block.ar.trim() || !block.en.trim()) classes.push('terms-doc__item--single');
  return classes.join(' ');
}

/** Bilingual numbered terms: English on the left, Arabic on the right, each clause framed on its own. */
export function TermsDocument({ blocks }: { blocks: readonly NumberedTermsBlock[] }) {
  return (
    <div className="terms-doc">
      {blocks.map((block, index) => (
        <div key={`${index}-${block.kind}`} className={itemClass(block)}>
          {block.en.trim() ? (
            <div className="terms-doc__cell terms-doc__cell--en" dir="ltr" lang="en">
              <span className="terms-doc__label">{block.labelEn}</span>
              <span className="terms-doc__text">{block.en}</span>
            </div>
          ) : null}
          {block.ar.trim() ? (
            <div className="terms-doc__cell terms-doc__cell--ar" dir="rtl" lang="ar">
              <span className="terms-doc__label">{block.labelAr}</span>
              <span className="terms-doc__text">{block.ar}</span>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function TermsLetterheadHeader({ letterhead }: { letterhead: TermsLetterhead }) {
  return (
    <header className="terms-letterhead">
      <div className="terms-letterhead__name" dir="ltr" lang="en">
        {letterhead.nameEn}
      </div>
      <div className="terms-letterhead__logo">
        {letterhead.logoDataUrl ? (
          <img src={letterhead.logoDataUrl} alt={letterhead.nameEn || letterhead.nameAr} />
        ) : null}
      </div>
      <div className="terms-letterhead__name" dir="rtl" lang="ar">
        {letterhead.nameAr}
      </div>
    </header>
  );
}

export function TermsLetterheadFooter({ letterhead }: { letterhead: TermsLetterhead }) {
  const contact = [
    letterhead.phone,
    letterhead.email,
    letterhead.registrationNumber ? `CR ${letterhead.registrationNumber}` : '',
  ].filter(Boolean);
  if (!letterhead.addressAr && !letterhead.addressEn && contact.length === 0) return null;
  return (
    <footer className="terms-letterhead-footer">
      <div className="terms-letterhead-footer__address" dir="ltr" lang="en">
        {letterhead.addressEn}
      </div>
      <div className="terms-letterhead-footer__contact" dir="ltr">
        {contact.join(' · ')}
      </div>
      <div className="terms-letterhead-footer__address" dir="rtl" lang="ar">
        {letterhead.addressAr}
      </div>
    </footer>
  );
}
