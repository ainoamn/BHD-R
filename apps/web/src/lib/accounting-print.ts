'use client';

import { accountingPrintPath, type AccountingPrintKind } from '@/lib/accounting-letterhead';
import { whatsappLink } from '@/lib/stay-deposit-claims';
import { renderWhatsAppMessage } from '@/lib/whatsapp-message';

/** Current accounting hub path (no locale) so print can return to the same tab/context. */
function currentAccountingReturn(): string | null {
  const path = `${window.location.pathname}${window.location.search}`.replace(
    /^\/(ar|en)(?=\/|$)/,
    '',
  );
  return path.startsWith('/owner/accounting') ? path : null;
}

/** Hub return URL with focus/open so Back highlights the printed row. */
function returnWithFocus(kind: AccountingPrintKind, id: string, from: string | null): string | null {
  const base = from ?? '/owner/accounting';
  if (!base.startsWith('/owner/accounting')) return from;
  const qIndex = base.indexOf('?');
  const path = qIndex >= 0 ? base.slice(0, qIndex) : base;
  const params = new URLSearchParams(qIndex >= 0 ? base.slice(qIndex + 1) : '');
  if (kind === 'document') {
    if (!params.get('tab')) params.set('tab', 'documents');
    if (/^[0-9a-f-]{36}$/i.test(id)) params.set('focus', id);
  } else if (kind === 'journal') {
    if (!params.get('tab')) params.set('tab', 'journal');
    if (/^[0-9a-f-]{36}$/i.test(id)) {
      params.set('open', id);
      params.set('focus', id);
    }
  } else if (kind === 'report' && !params.get('tab')) {
    params.set('tab', 'reports');
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * Open the letterheaded print page in a new tab only.
 * Do not pass `noopener` to window.open — browsers then return null and a naive
 * fallback would also navigate the current tab (double open).
 */
export function openAccountingPrint(
  locale: 'ar' | 'en',
  kind: AccountingPrintKind,
  id: string,
  extra?: Record<string, string>,
): string | null {
  const from = returnWithFocus(kind, id, extra?.from ?? currentAccountingReturn());
  const path = accountingPrintPath(locale, kind, id, {
    ...(extra ?? {}),
    ...(from ? { from } : {}),
  });
  const opened = window.open(path, '_blank');
  if (opened) {
    opened.opener = null;
    return null;
  }
  // Popup blocked: same-tab only (never both).
  window.location.assign(path);
  return null;
}

export async function printAccountingJournal(
  journal: { id: string },
  locale: 'ar' | 'en',
): Promise<string | null> {
  return openAccountingPrint(locale, 'journal', journal.id);
}

export async function printAccountingDocument(
  doc: { id: string },
  locale: 'ar' | 'en',
): Promise<string | null> {
  return openAccountingPrint(locale, 'document', doc.id);
}

export async function printAccountingReport(
  input: {
    title: string;
    reportKind?: string;
    fromDate?: string;
    toDate?: string;
  },
  locale: 'ar' | 'en',
): Promise<string | null> {
  const kind = input.reportKind || 'trial';
  return openAccountingPrint(locale, 'report', `${kind}-${input.toDate || 'asof'}`, {
    report: kind,
    ...(input.fromDate ? { fromDate: input.fromDate } : {}),
    ...(input.toDate ? { toDate: input.toDate } : {}),
  });
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
  const rendered = renderWhatsAppMessage(
    {
      tone: 'invoice',
      titleAr: input.title,
      titleEn: input.title,
      details: [
        { labelAr: 'المرجع', labelEn: 'Ref', value: input.reference },
        { labelAr: 'التاريخ', labelEn: 'Date', value: input.occurredOn },
        { labelAr: 'المبلغ', labelEn: 'Amount', value: input.amountText },
      ],
      linkLabelAr: 'فتح المستند',
      linkLabelEn: 'Open document',
      ...(input.link ? { link: input.link } : {}),
    },
    { seed: `acct:${input.reference}` },
  );
  const text = input.locale === 'ar' ? rendered.textAr : rendered.textEn;
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
