import 'server-only';
import { and, eq } from 'drizzle-orm';
import { journalLines, parties } from '@bhd-r/db';
import type { SessionClaims } from '@bhd-r/authz';
import {
  canReadAccounting,
  fail,
  getJournal,
  listAccountingDocuments,
} from '@/lib/accounting-gl-neon';
import { accountingClientShareUrl } from '@/lib/accounting-letterhead-neon';
import { appLink, notifyByEmail } from '@/lib/email-notify';
import { formatMoney } from '@/lib/format';
import { whatsappLink } from '@/lib/stay-deposit-claims';
import { withinViewerTenant } from '@/lib/portal-ops-data';
import { renderWhatsAppMessage } from '@/lib/whatsapp-message';

function accountingWhatsAppText(input: {
  tone?: 'invoice' | 'reminder';
  titleAr: string;
  titleEn: string;
  seed: string;
  details: ReadonlyArray<{ labelAr: string; labelEn: string; value: string }>;
  link: string;
  linkLabelAr: string;
  linkLabelEn: string;
  locale: 'ar' | 'en';
  /** When true, ship AR+EN in one bubble (default for shares). */
  bilingual?: boolean;
}): string {
  const rendered = renderWhatsAppMessage(
    {
      tone: input.tone ?? 'invoice',
      titleAr: input.titleAr,
      titleEn: input.titleEn,
      details: input.details,
      link: input.link,
      linkLabelAr: input.linkLabelAr,
      linkLabelEn: input.linkLabelEn,
    },
    { seed: input.seed },
  );
  if (input.bilingual !== false) return rendered.combined;
  return input.locale === 'ar' ? rendered.textAr : rendered.textEn;
}

export type AccountingSendKind = 'journal' | 'document' | 'report';

export type AccountingSendResult = {
  emailed: number;
  whatsappUrl: string | null;
  mailtoUrl: string | null;
  reference: string;
  title: string;
};

function moneyText(minor: string, currency: string, ar: boolean) {
  if (!minor || minor === '0') return '—';
  return formatMoney(minor, currency || 'OMR', ar ? 'ar' : 'en');
}

/** Queue branded email + return WhatsApp / mailto deep links for an accounting artefact. */
export async function sendAccountingArtifact(
  claims: SessionClaims,
  input: {
    kind: AccountingSendKind;
    id: string;
    channel: 'email' | 'whatsapp' | 'both';
    locale: 'ar' | 'en';
    /** Optional override — otherwise looked up from the journal/document party. */
    email?: string | null;
    phone?: string | null;
    reportSummary?: string | null;
  },
): Promise<AccountingSendResult> {
  if (!canReadAccounting(claims)) fail('forbidden');
  const ar = input.locale === 'ar';
  const orgId = claims.organizationId!;

  if (input.kind === 'journal') {
    const journal = await getJournal(claims, input.id);
    const partyContact = await withinViewerTenant(claims, async (tx) => {
      const line = await tx
        .select({
          email: parties.email,
          phone: parties.phone,
          name: parties.displayName,
        })
        .from(journalLines)
        .innerJoin(parties, eq(parties.id, journalLines.partyId))
        .where(
          and(eq(journalLines.journalEntryId, input.id), eq(journalLines.organizationId, orgId)),
        )
        .limit(1);
      return line[0] ?? null;
    });
    const title = ar ? 'قيد يومية' : 'Journal entry';
    const amount = moneyText(journal.totals.debitMinor, 'OMR', ar);
    const share =
      (await accountingClientShareUrl(claims, {
        kind: 'journal',
        id: journal.id,
        locale: input.locale,
      })) ?? appLink(`/${input.locale}/owner/accounting/print?kind=journal&id=${journal.id}`);
    const email = input.email ?? partyContact?.email ?? null;
    const phone = input.phone ?? partyContact?.phone ?? null;
    let emailed = 0;
    if (input.channel === 'email' || input.channel === 'both') {
      emailed = await notifyByEmail({
        orgId,
        aggregateType: 'journal_entry',
        aggregateId: journal.id,
        dedupeKey: `accounting-send:journal:${journal.id}`,
        audience: {
          addresses: email ? [{ email, name: partyContact?.name ?? null }] : [],
          ...(email ? {} : { managersOf: { orgId } }),
        },
        content: () => ({
          tone: 'invoice' as const,
          subject: `${title} ${journal.reference}`,
          title,
          intro: ar
            ? `قيد محاسبي ${journal.reference} بتاريخ ${journal.occurredOn}.`
            : `Journal ${journal.reference} dated ${journal.occurredOn}.`,
          details: [
            { label: ar ? 'المرجع' : 'Reference', value: journal.reference },
            { label: ar ? 'المبلغ' : 'Amount', value: amount },
            { label: ar ? 'البيان' : 'Description', value: journal.description },
          ],
          cta: { label: ar ? 'عرض المستند الرسمي' : 'View official document', url: share },
        }),
      });
    }
    const text = accountingWhatsAppText({
      titleAr: 'قيد يومية',
      titleEn: 'Journal entry',
      seed: `journal:${journal.id}`,
      locale: input.locale,
      details: [
        { labelAr: 'المرجع', labelEn: 'Reference', value: journal.reference },
        { labelAr: 'التاريخ', labelEn: 'Date', value: journal.occurredOn },
        { labelAr: 'البيان', labelEn: 'Description', value: journal.description },
        { labelAr: 'المبلغ', labelEn: 'Amount', value: amount },
      ],
      link: share,
      linkLabelAr: 'عرض المستند الرسمي',
      linkLabelEn: 'View official document',
    });
    return {
      emailed,
      whatsappUrl:
        input.channel === 'email'
          ? null
          : phone
            ? whatsappLink(phone, text)
            : `https://wa.me/?text=${encodeURIComponent(text)}`,
      mailtoUrl: `mailto:${email ?? ''}?subject=${encodeURIComponent(`${title} ${journal.reference}`)}&body=${encodeURIComponent(text)}`,
      reference: journal.reference,
      title,
    };
  }

  if (input.kind === 'document') {
    const docs = await listAccountingDocuments(claims, 200);
    const found = docs.find((row) => row.id === input.id);
    if (!found) fail('not_found');
    const doc = found;
    const title =
      doc.kind === 'receipt'
        ? ar
          ? 'إيصال قبض'
          : 'Receipt'
        : doc.kind === 'invoice'
          ? ar
            ? 'فاتورة مطالبة'
            : 'Demand invoice'
          : ar
            ? 'مستند محاسبي'
            : 'Accounting document';
    const amount = moneyText(doc.amountMinor, doc.currency, ar);
    const share =
      (await accountingClientShareUrl(claims, {
        kind: 'document',
        id: doc.id,
        locale: input.locale,
      })) ??
      appLink(
        `/${input.locale}/owner/accounting/print?kind=document&id=${encodeURIComponent(doc.id)}`,
      );
    const email = input.email ?? null;
    const phone = input.phone ?? null;
    let emailed = 0;
    if (input.channel === 'email' || input.channel === 'both') {
      emailed = await notifyByEmail({
        orgId,
        aggregateType: `accounting_${doc.kind}`,
        aggregateId: doc.id,
        dedupeKey: `accounting-send:doc:${doc.kind}:${doc.id}`,
        audience: {
          addresses: email ? [{ email, name: doc.partyName }] : [],
          ...(email ? {} : { managersOf: { orgId } }),
        },
        content: () => ({
          tone: 'invoice' as const,
          subject: `${title} ${doc.reference}`,
          title,
          intro: ar
            ? `${title} ${doc.reference} بمبلغ ${amount}.`
            : `${title} ${doc.reference} for ${amount}.`,
          details: [
            { label: ar ? 'المرجع' : 'Reference', value: doc.reference },
            { label: ar ? 'المبلغ' : 'Amount', value: amount },
            { label: ar ? 'الطرف' : 'Party', value: doc.partyName ?? '—' },
          ],
          cta: { label: ar ? 'عرض المستند الرسمي' : 'View official document', url: share },
        }),
      });
    }
    const titleAr =
      doc.kind === 'receipt'
        ? 'إيصال قبض'
        : doc.kind === 'invoice'
          ? 'فاتورة مطالبة'
          : 'مستند محاسبي';
    const titleEn =
      doc.kind === 'receipt'
        ? 'Receipt'
        : doc.kind === 'invoice'
          ? 'Demand invoice'
          : 'Accounting document';
    const text = accountingWhatsAppText({
      titleAr,
      titleEn,
      seed: `doc:${doc.id}`,
      locale: input.locale,
      details: [
        { labelAr: 'المرجع', labelEn: 'Reference', value: doc.reference },
        { labelAr: 'التاريخ', labelEn: 'Date', value: doc.occurredOn },
        { labelAr: 'المبلغ', labelEn: 'Amount', value: amount },
        ...(doc.partyName ? [{ labelAr: 'الطرف', labelEn: 'Party', value: doc.partyName }] : []),
      ],
      link: share,
      linkLabelAr: 'عرض المستند الرسمي',
      linkLabelEn: 'View official document',
    });
    return {
      emailed,
      whatsappUrl:
        input.channel === 'email'
          ? null
          : phone
            ? whatsappLink(phone, text)
            : `https://wa.me/?text=${encodeURIComponent(text)}`,
      mailtoUrl: `mailto:${email ?? ''}?subject=${encodeURIComponent(`${title} ${doc.reference}`)}&body=${encodeURIComponent(text)}`,
      reference: doc.reference,
      title,
    };
  }

  // report
  const title = ar ? 'تقرير محاسبي' : 'Accounting report';
  const summary = (input.reportSummary ?? '').trim() || title;
  const link = appLink(`/${input.locale}/owner/accounting?tab=reports`);
  const text = accountingWhatsAppText({
    titleAr: 'تقرير محاسبي',
    titleEn: 'Accounting report',
    seed: `report:${input.id || 'report'}`,
    locale: input.locale,
    details: [{ labelAr: 'الملخص', labelEn: 'Summary', value: summary.slice(0, 300) }],
    link,
    linkLabelAr: 'فتح التقارير',
    linkLabelEn: 'Open reports',
  });
  let emailed = 0;
  if (input.channel === 'email' || input.channel === 'both') {
    emailed = await notifyByEmail({
      orgId,
      aggregateType: 'accounting_report',
      aggregateId: input.id || 'report',
      dedupeKey: `accounting-send:report:${input.id}:${Date.now()}`,
      audience: {
        addresses: input.email ? [{ email: input.email, name: null }] : [],
        ...(input.email ? {} : { managersOf: { orgId } }),
      },
      content: () => ({
        tone: 'invoice' as const,
        subject: title,
        title,
        intro: summary.slice(0, 400),
        details: [{ label: ar ? 'الملخص' : 'Summary', value: summary.slice(0, 300) }],
        cta: { label: ar ? 'فتح التقارير' : 'Open reports', url: link },
      }),
    });
  }
  return {
    emailed,
    whatsappUrl:
      input.channel === 'email'
        ? null
        : input.phone
          ? whatsappLink(input.phone, text)
          : `https://wa.me/?text=${encodeURIComponent(text)}`,
    mailtoUrl: `mailto:${input.email ?? ''}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`,
    reference: input.id || 'report',
    title,
  };
}

/** After a journal is posted, email the linked party once (idempotent via dedupeKey). */
export async function notifyPartyOnJournalPosted(
  claims: SessionClaims,
  journalId: string,
  locale: 'ar' | 'en' = 'ar',
): Promise<number> {
  if (!claims.organizationId) return 0;
  try {
    const result = await sendAccountingArtifact(claims, {
      kind: 'journal',
      id: journalId,
      channel: 'email',
      locale,
    });
    return result.emailed;
  } catch {
    return 0;
  }
}
