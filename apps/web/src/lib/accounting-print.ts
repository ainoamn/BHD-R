'use client';

import { formatMoney } from '@/lib/format';
import { whatsappLink } from '@/lib/stay-deposit-claims';

function esc(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function openPrintHtml(html: string, ar: boolean): string | null {
  const popup = window.open('', '_blank', 'noopener,noreferrer,width=900,height=900');
  if (!popup) {
    return ar ? 'اسمح بالنوافذ المنبثقة للطباعة' : 'Allow pop-ups to print';
  }
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  window.setTimeout(() => popup.print(), 250);
  return null;
}

const PRINT_CSS = `body{font-family:Tahoma,Arial,sans-serif;padding:28px;color:#111;max-width:860px;margin:auto}
h1{font-size:1.25rem;margin:0 0 .25rem}p.sub{margin:0 0 1rem;color:#555;font-size:.92rem}
table{width:100%;border-collapse:collapse;margin-top:.75rem}
th,td{border:1px solid #bbb;padding:.4rem .55rem;font-size:.9rem;text-align:start;vertical-align:top}
th{background:#f3f3f3;font-weight:600}.num{text-align:end;font-variant-numeric:tabular-nums}
.meta{margin:.2rem 0;font-size:.95rem}.foot{margin-top:1.25rem;color:#555;font-size:.85rem}
.sign{display:flex;justify-content:space-between;margin-top:2.5rem;font-size:.9rem}
.sign span{border-top:1px solid #333;padding-top:.3rem;min-width:12rem;text-align:center}`;

export type PrintJournalInput = {
  reference: string;
  occurredOn: string;
  description: string;
  status: string;
  sourceType?: string | null;
  totals: { debitMinor: string; creditMinor: string };
  lines: Array<{
    code: string;
    nameAr: string;
    nameEn: string;
    debitMinor: string;
    creditMinor: string;
    currency: string;
    memo: string | null;
    partyName: string | null;
    propertyNameAr: string | null;
    unitCode: string | null;
  }>;
};

export function printAccountingJournal(
  journal: PrintJournalInput,
  locale: 'ar' | 'en',
): string | null {
  const ar = locale === 'ar';
  const money = (minor: string, currency: string) =>
    !minor || minor === '0' ? '—' : formatMoney(minor, currency, locale);
  const rows = journal.lines
    .map((line) => {
      const dim = [line.partyName, line.propertyNameAr, line.unitCode].filter(Boolean).join(' · ');
      return `<tr>
<td>${esc(line.code)} · ${esc(ar ? line.nameAr : line.nameEn)}</td>
<td>${esc(dim || '—')}</td>
<td>${esc(line.memo || '—')}</td>
<td class="num" dir="ltr">${money(line.debitMinor, line.currency)}</td>
<td class="num" dir="ltr">${money(line.creditMinor, line.currency)}</td>
</tr>`;
    })
    .join('');
  const html = `<!DOCTYPE html><html lang="${locale}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"/><title>${esc(journal.reference)}</title>
<style>${PRINT_CSS}</style></head><body>
<h1>BHD R · ${ar ? 'قيد يومية' : 'Journal entry'}</h1>
<p class="sub">${ar ? 'قيد مزدوج من محاسبة العقارات التشغيلية' : 'Double-entry from the property operational GL'}</p>
<p class="meta"><strong>${ar ? 'المرجع' : 'Reference'}:</strong> ${esc(journal.reference)}</p>
<p class="meta"><strong>${ar ? 'التاريخ' : 'Date'}:</strong> ${esc(journal.occurredOn)}</p>
<p class="meta"><strong>${ar ? 'الحالة' : 'Status'}:</strong> ${esc(journal.status)}</p>
<p class="meta"><strong>${ar ? 'البيان' : 'Description'}:</strong> ${esc(journal.description)}</p>
${journal.sourceType ? `<p class="meta"><strong>${ar ? 'المصدر' : 'Source'}:</strong> ${esc(journal.sourceType)}</p>` : ''}
<table><thead><tr>
<th>${ar ? 'الحساب' : 'Account'}</th>
<th>${ar ? 'البُعد' : 'Dimension'}</th>
<th>${ar ? 'ملاحظة' : 'Memo'}</th>
<th class="num">${ar ? 'مدين' : 'Debit'}</th>
<th class="num">${ar ? 'دائن' : 'Credit'}</th>
</tr></thead><tbody>${rows}</tbody>
<tfoot><tr><th colspan="3">${ar ? 'الإجمالي' : 'Total'}</th>
<th class="num" dir="ltr">${money(journal.totals.debitMinor, 'OMR')}</th>
<th class="num" dir="ltr">${money(journal.totals.creditMinor, 'OMR')}</th>
</tr></tfoot></table>
<p class="foot">${ar ? 'الأستاذ الضريبي المفصّل والضريبة في Hisaby (حسابي) عند الربط.' : 'Detailed tax GL lives in Hisaby when linked.'}</p>
<div class="sign"><span>${ar ? 'المحاسب' : 'Accountant'}</span><span>${ar ? 'المالك / الإدارة' : 'Owner / management'}</span></div>
</body></html>`;
  return openPrintHtml(html, ar);
}

export type PrintDocumentInput = {
  kind: 'invoice' | 'receipt' | 'journal';
  reference: string;
  title: string;
  status: string;
  amountMinor: string;
  currency: string;
  occurredOn: string;
  partyName: string | null;
  propertyLabel: string | null;
  note: string | null;
};

export function printAccountingDocument(
  doc: PrintDocumentInput,
  locale: 'ar' | 'en',
): string | null {
  const ar = locale === 'ar';
  const kindLabel =
    doc.kind === 'receipt'
      ? ar
        ? 'إيصال قبض'
        : 'Receipt'
      : doc.kind === 'invoice'
        ? ar
          ? 'فاتورة مطالبة'
          : 'Demand invoice'
        : ar
          ? 'قيد يومية'
          : 'Journal';
  const amount =
    doc.amountMinor && doc.amountMinor !== '0'
      ? formatMoney(doc.amountMinor, doc.currency || 'OMR', locale)
      : '—';
  const html = `<!DOCTYPE html><html lang="${locale}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"/><title>${esc(kindLabel)} ${esc(doc.reference)}</title>
<style>${PRINT_CSS}</style></head><body>
<h1>BHD R · ${esc(kindLabel)}</h1>
<p class="sub">${esc(doc.title)}</p>
<table><tbody>
<tr><th>${ar ? 'المرجع' : 'Reference'}</th><td dir="ltr">${esc(doc.reference)}</td></tr>
<tr><th>${ar ? 'التاريخ' : 'Date'}</th><td>${esc(doc.occurredOn)}</td></tr>
<tr><th>${ar ? 'الحالة' : 'Status'}</th><td>${esc(doc.status)}</td></tr>
<tr><th>${ar ? 'الطرف' : 'Party'}</th><td>${esc(doc.partyName || '—')}</td></tr>
<tr><th>${ar ? 'العقار' : 'Property'}</th><td>${esc(doc.propertyLabel || '—')}</td></tr>
<tr><th>${ar ? 'المبلغ' : 'Amount'}</th><td dir="ltr"><strong>${esc(amount)}</strong></td></tr>
<tr><th>${ar ? 'ملاحظة' : 'Note'}</th><td>${esc(doc.note || '—')}</td></tr>
</tbody></table>
<p class="foot">${ar ? 'مستند تشغيلي من برنامج العقارات. الميزان والضريبة في Hisaby عند الربط.' : 'Operational slip from the property app. Trial balance and tax live in Hisaby when linked.'}</p>
<div class="sign"><span>${ar ? 'المحاسب' : 'Accountant'}</span><span>${ar ? 'المالك / الإدارة' : 'Owner / management'}</span></div>
</body></html>`;
  return openPrintHtml(html, ar);
}

export type PrintReportInput = {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: string[][];
  footer?: string;
};

export function printAccountingReport(input: PrintReportInput, locale: 'ar' | 'en'): string | null {
  const ar = locale === 'ar';
  const head = input.columns.map((col) => `<th>${esc(col)}</th>`).join('');
  const body = input.rows
    .map(
      (row) =>
        `<tr>${row.map((cell, index) => `<td${index >= row.length - 2 ? ' class="num" dir="ltr"' : ''}>${esc(cell)}</td>`).join('')}</tr>`,
    )
    .join('');
  const html = `<!DOCTYPE html><html lang="${locale}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"/><title>${esc(input.title)}</title>
<style>${PRINT_CSS}</style></head><body>
<h1>BHD R · ${esc(input.title)}</h1>
${input.subtitle ? `<p class="sub">${esc(input.subtitle)}</p>` : ''}
<table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${input.columns.length}">${ar ? 'لا بيانات' : 'No data'}</td></tr>`}</tbody></table>
${input.footer ? `<p class="foot">${esc(input.footer)}</p>` : ''}
</body></html>`;
  return openPrintHtml(html, ar);
}

/** Build a WhatsApp share URL for an accounting document (opens wa.me; Meta Cloud API is Hisaby-side). */
export function accountingWhatsappShare(input: {
  phone?: string | null;
  title: string;
  reference: string;
  amountText: string;
  occurredOn: string;
  link?: string;
  locale: 'ar' | 'en';
}): string {
  const ar = input.locale === 'ar';
  const lines = [
    `BHD R · ${input.title}`,
    `${ar ? 'المرجع' : 'Ref'}: ${input.reference}`,
    `${ar ? 'التاريخ' : 'Date'}: ${input.occurredOn}`,
    `${ar ? 'المبلغ' : 'Amount'}: ${input.amountText}`,
  ];
  if (input.link) lines.push(input.link);
  const text = lines.join('\n');
  if (input.phone) {
    const url = whatsappLink(input.phone, text);
    if (url) return url;
  }
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function accountingMailtoShare(input: {
  email?: string | null;
  title: string;
  reference: string;
  body: string;
}): string {
  const subject = encodeURIComponent(`${input.title} ${input.reference}`);
  const body = encodeURIComponent(input.body);
  return `mailto:${input.email ?? ''}?subject=${subject}&body=${body}`;
}
