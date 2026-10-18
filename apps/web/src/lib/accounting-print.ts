'use client';

import { accountingPrintPath, type AccountingPrintKind } from '@/lib/accounting-letterhead';
import { whatsappLink } from '@/lib/stay-deposit-claims';

/** Open the letterheaded print page (same flow as rent invoices → Save as PDF). */
export function openAccountingPrint(
  locale: 'ar' | 'en',
  kind: AccountingPrintKind,
  id: string,
  extra?: Record<string, string>,
): string | null {
  const path = accountingPrintPath(locale, kind, id, extra);
  const opened = window.open(path, '_blank', 'noopener,noreferrer');
  if (!opened) {
    window.location.assign(path);
  }
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
