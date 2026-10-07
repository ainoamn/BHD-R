import type { NumberedTermsBlock } from '@/lib/booking-terms';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Same markup as `TermsDocument`, as an HTML string for contract documents. */
export function termsDocumentHtml(blocks: readonly NumberedTermsBlock[]): string {
  const items = blocks
    .map((block) => {
      const classes = ['terms-doc__item', `terms-doc__item--${block.kind}`];
      if (block.platform) classes.push('terms-doc__item--platform');
      if (!block.ar.trim() || !block.en.trim()) classes.push('terms-doc__item--single');
      const en = block.en.trim()
        ? `<div class="terms-doc__cell terms-doc__cell--en" dir="ltr" lang="en"><span class="terms-doc__label">${escapeHtml(block.labelEn)}</span><span class="terms-doc__text">${escapeHtml(block.en)}</span></div>`
        : '';
      const ar = block.ar.trim()
        ? `<div class="terms-doc__cell terms-doc__cell--ar" dir="rtl" lang="ar"><span class="terms-doc__label">${escapeHtml(block.labelAr)}</span><span class="terms-doc__text">${escapeHtml(block.ar)}</span></div>`
        : '';
      return `<div class="${classes.join(' ')}">${en}${ar}</div>`;
    })
    .join('');
  return `<div class="terms-doc">${items}</div>`;
}
