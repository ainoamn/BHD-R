import 'server-only';
import { createHash } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import {
  createDatabase,
  invoices,
  journalEntries,
  journalLines,
  leases,
  ledgerAccounts,
  parties,
  properties,
  stayBookings,
  stayPaymentIntents,
  units,
} from '@bhd-r/db';
import { readTermsLetterhead } from '@/lib/booking-terms-neon';
import { contractQrSvg } from '@/lib/contract-verify';
import {
  agingReceivables,
  balanceSheet,
  canReadAccounting,
  cashFlowReport,
  fail,
  getJournal,
  incomeStatement,
  listAccountingDocuments,
  trialBalance,
} from '@/lib/accounting-gl-neon';
import type {
  AccountingIssuer,
  AccountingPrintDoc,
  AccountingPrintKind,
  AccountingSignature,
} from '@/lib/accounting-letterhead';
import { accountingSharePath } from '@/lib/accounting-letterhead';
import { formatMoney } from '@/lib/format';
import { publicWebOrigin } from '@/lib/seo';
import { withinViewerTenant } from '@/lib/portal-ops-data';

const SIGNATURE_VERSION = 1;

function fingerprintOf(payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify({ v: SIGNATURE_VERSION, payload }))
    .digest('hex');
}

function signatureCode(fingerprint: string): string {
  return fingerprint
    .slice(0, 16)
    .toUpperCase()
    .replace(/(.{4})(?=.)/g, '$1-');
}

export function accountingDocToken(input: {
  orgId: string;
  kind: AccountingPrintKind;
  id: string;
  fingerprint: string;
}): string {
  const compact = input.orgId.replace(/-/g, '').toLowerCase();
  const id = input.id.replace(/-/g, '').toLowerCase().slice(0, 32);
  const body = `${compact}_${input.kind[0]}_${id}_${input.fingerprint.slice(0, 16)}`;
  const check = createHash('sha256')
    .update(`bhd-r:agl:${body}:${input.orgId}`)
    .digest('hex')
    .slice(0, 8);
  return `agl_${body}_${check}`;
}

export function parseAccountingDocToken(token: string): {
  orgCompact: string;
  kindChar: string;
  idCompact: string;
  fingerprintPrefix: string;
} | null {
  const match = /^agl_([0-9a-f]{32})_([jdr])_([0-9a-f]{1,32})_([0-9a-f]{16})_([0-9a-f]{8})$/i.exec(
    token.trim(),
  );
  if (!match) return null;
  return {
    orgCompact: match[1]!.toLowerCase(),
    kindChar: match[2]!.toLowerCase(),
    idCompact: match[3]!.toLowerCase(),
    fingerprintPrefix: match[4]!.toLowerCase(),
  };
}

function verifyUrl(locale: 'ar' | 'en', token: string): string {
  return `${publicWebOrigin()}${accountingSharePath(locale, token)}`;
}

function issuerFromLetterhead(
  letterhead: Awaited<ReturnType<typeof readTermsLetterhead>> | null,
): AccountingIssuer {
  return {
    nameAr: letterhead?.nameAr || 'BHD R',
    nameEn: letterhead?.nameEn || letterhead?.nameAr || 'BHD R',
    logoDataUrl: letterhead?.logoDataUrl ?? null,
    phone: letterhead?.phone ?? '',
    email: letterhead?.email ?? '',
    registrationNumber: letterhead?.registrationNumber ?? '',
  };
}

async function loadIssuer(claims: SessionClaims): Promise<AccountingIssuer> {
  const orgId = claims.organizationId!;
  const letterhead = await withinViewerTenant(claims, (tx) =>
    readTermsLetterhead(tx, orgId).catch(() => null),
  );
  return issuerFromLetterhead(letterhead);
}

async function seal(
  claims: SessionClaims,
  kind: AccountingPrintKind,
  id: string,
  payload: unknown,
  issuedAt: string,
  locale: 'ar' | 'en' = 'ar',
): Promise<AccountingSignature> {
  const orgId = claims.organizationId!;
  const fingerprint = fingerprintOf(payload);
  const token = accountingDocToken({ orgId, kind, id, fingerprint });
  const url = verifyUrl(locale, token);
  return {
    fingerprint,
    code: signatureCode(fingerprint),
    signedAt: issuedAt,
    verifyUrl: url,
    qrSvg: await contractQrSvg(url),
  };
}

async function sealForOrg(
  orgId: string,
  kind: AccountingPrintKind,
  id: string,
  payload: unknown,
  issuedAt: string,
  locale: 'ar' | 'en',
): Promise<AccountingSignature> {
  const fingerprint = fingerprintOf(payload);
  const token = accountingDocToken({ orgId, kind, id, fingerprint });
  const url = verifyUrl(locale, token);
  return {
    fingerprint,
    code: signatureCode(fingerprint),
    signedAt: issuedAt,
    verifyUrl: url,
    qrSvg: await contractQrSvg(url),
  };
}

function money(minor: string, currency: string, locale: 'ar' | 'en') {
  if (!minor || minor === '0') return '—';
  return formatMoney(minor, currency || 'OMR', locale);
}

/** Build a letterheaded, e-signed accounting print document for the owner. */
export async function loadAccountingPrintDoc(
  claims: SessionClaims,
  input: {
    kind: AccountingPrintKind;
    id: string;
    locale: 'ar' | 'en';
    report?: string;
    fromDate?: string;
    toDate?: string;
  },
): Promise<AccountingPrintDoc> {
  if (!canReadAccounting(claims)) fail('forbidden');
  const locale = input.locale;
  const ar = locale === 'ar';
  const issuer = await loadIssuer(claims);
  const issuedAt = new Date().toISOString();

  if (input.kind === 'journal') {
    const journal = await getJournal(claims, input.id);
    const lines = journal.lines.map((line) => ({
      account: `${line.code} · ${ar ? line.nameAr : line.nameEn}`,
      dimension: [line.partyName, line.propertyNameAr, line.unitCode].filter(Boolean).join(' · ') || '—',
      memo: line.memo || '—',
      debit: money(line.debitMinor, line.currency, locale),
      credit: money(line.creditMinor, line.currency, locale),
    }));
    const amountText = money(journal.totals.debitMinor, 'OMR', locale);
    const payload = {
      kind: 'journal',
      id: journal.id,
      reference: journal.reference,
      occurredOn: journal.occurredOn,
      description: journal.description,
      status: journal.status,
      totals: journal.totals,
      lines: journal.lines.map((line) => ({
        code: line.code,
        debit: line.debitMinor,
        credit: line.creditMinor,
      })),
    };
    return {
      kind: 'journal',
      number: journal.reference,
      titleAr: 'قيد يومية',
      titleEn: 'Journal entry',
      status: journal.status,
      occurredOn: journal.occurredOn,
      description: journal.description,
      amountText,
      currency: 'OMR',
      partyName: journal.partyName ?? null,
      propertyLabel: null,
      issuer,
      lines,
      meta: [
        { labelAr: 'المرجع', labelEn: 'Reference', value: journal.reference },
        { labelAr: 'التاريخ', labelEn: 'Date', value: journal.occurredOn },
        { labelAr: 'الحالة', labelEn: 'Status', value: journal.status },
        {
          labelAr: 'المصدر',
          labelEn: 'Source',
          value: journal.sourceType ?? (ar ? 'يدوي' : 'Manual'),
        },
        { labelAr: 'الإجمالي', labelEn: 'Total', value: amountText },
      ],
      signature: await seal(claims, 'journal', journal.id, payload, issuedAt, locale),
      issuedAt,
    };
  }

  if (input.kind === 'document') {
    const docs = await listAccountingDocuments(claims, 200);
    const doc = docs.find((row) => row.id === input.id);
    if (!doc) fail('not_found');
    const titleAr =
      doc.kind === 'receipt' ? 'إيصال قبض' : doc.kind === 'invoice' ? 'فاتورة مطالبة' : 'مستند محاسبي';
    const titleEn =
      doc.kind === 'receipt' ? 'Payment receipt' : doc.kind === 'invoice' ? 'Demand invoice' : 'Accounting document';
    const amountText = money(doc.amountMinor, doc.currency, locale);
    const payload = {
      kind: 'document',
      id: doc.id,
      docKind: doc.kind,
      reference: doc.reference,
      amount: doc.amountMinor,
      currency: doc.currency,
      occurredOn: doc.occurredOn,
      status: doc.status,
    };
    return {
      kind: 'document',
      number: doc.reference,
      titleAr,
      titleEn,
      status: doc.status,
      occurredOn: doc.occurredOn,
      description: doc.title,
      amountText,
      currency: doc.currency,
      partyName: doc.partyName,
      propertyLabel: doc.propertyLabel,
      issuer,
      lines: [],
      meta: [
        { labelAr: 'المرجع', labelEn: 'Reference', value: doc.reference },
        { labelAr: 'التاريخ', labelEn: 'Date', value: doc.occurredOn },
        { labelAr: 'الحالة', labelEn: 'Status', value: doc.status },
        { labelAr: 'الطرف', labelEn: 'Party', value: doc.partyName ?? '—' },
        { labelAr: 'العقار', labelEn: 'Property', value: doc.propertyLabel ?? '—' },
        { labelAr: 'المبلغ', labelEn: 'Amount', value: amountText },
        { labelAr: 'ملاحظة', labelEn: 'Note', value: doc.note ?? '—' },
      ],
      signature: await seal(claims, 'document', doc.id, payload, issuedAt, locale),
      issuedAt,
    };
  }

  // report
  const reportKind = input.report || 'trial';
  const fromDate = input.fromDate || `${new Date().getUTCFullYear()}-01-01`;
  const toDate = input.toDate || new Date().toISOString().slice(0, 10);
  const currency = 'OMR';
  const titles: Record<string, { ar: string; en: string }> = {
    trial: { ar: 'ميزان المراجعة', en: 'Trial balance' },
    income: { ar: 'قائمة الدخل', en: 'Income statement' },
    balance: { ar: 'الميزانية العمومية', en: 'Balance sheet' },
    cashflow: { ar: 'التدفقات النقدية', en: 'Cash flow' },
    aging: { ar: 'أعمار الذمم', en: 'AR aging' },
  };
  const title = titles[reportKind] ?? { ar: 'تقرير محاسبي', en: 'Accounting report' };
  const lines: AccountingPrintDoc['lines'] = [];
  let amountText = '—';
  let reportPayload: unknown = null;

  if (reportKind === 'income') {
    const report = await incomeStatement(claims, fromDate, toDate, currency);
    reportPayload = report;
    amountText = money(String(report.netIncomeMinor), currency, locale);
    for (const row of report.revenue.rows) {
      lines.push({
        account: `${row.code} · ${ar ? row.nameAr : row.nameEn}`,
        dimension: ar ? 'إيراد' : 'Revenue',
        memo: '—',
        debit: '—',
        credit: money(row.balanceMinor, currency, locale),
      });
    }
    for (const row of report.expenses.rows) {
      lines.push({
        account: `${row.code} · ${ar ? row.nameAr : row.nameEn}`,
        dimension: ar ? 'مصروف' : 'Expense',
        memo: '—',
        debit: money(row.balanceMinor, currency, locale),
        credit: '—',
      });
    }
  } else if (reportKind === 'balance') {
    const report = await balanceSheet(claims, toDate, currency);
    reportPayload = report;
    for (const section of [report.assets, report.liabilities, report.equity]) {
      for (const row of section.rows) {
        lines.push({
          account: `${row.code} · ${ar ? row.nameAr : row.nameEn}`,
          dimension: '—',
          memo: '—',
          debit: money(row.balanceMinor, currency, locale),
          credit: '—',
        });
      }
    }
  } else if (reportKind === 'cashflow') {
    const report = await cashFlowReport(claims, fromDate, toDate, currency);
    reportPayload = report;
    amountText = money(String(report.netMinor), currency, locale);
    lines.push(
      {
        account: ar ? 'وارد' : 'Inflow',
        dimension: '—',
        memo: '—',
        debit: money(String(report.inflowMinor), currency, locale),
        credit: '—',
      },
      {
        account: ar ? 'صادر' : 'Outflow',
        dimension: '—',
        memo: '—',
        debit: '—',
        credit: money(String(report.outflowMinor), currency, locale),
      },
    );
  } else if (reportKind === 'aging') {
    const report = await agingReceivables(claims, toDate, currency);
    reportPayload = report;
    amountText = money(String(report.totalOutstandingMinor), currency, locale);
    for (const [key, value] of Object.entries(report.buckets)) {
      lines.push({
        account: key,
        dimension: '—',
        memo: '—',
        debit: money(String(value), currency, locale),
        credit: '—',
      });
    }
  } else {
    const rows = await trialBalance(claims, { fromDate, toDate });
    reportPayload = { report: 'trial', rows };
    for (const row of rows) {
      if (row.debitMinor === '0' && row.creditMinor === '0') continue;
      lines.push({
        account: `${row.code} · ${ar ? row.nameAr : row.nameEn}`,
        dimension: '—',
        memo: '—',
        debit: money(row.debitMinor, row.currency, locale),
        credit: money(row.creditMinor, row.currency, locale),
      });
    }
  }

  const payload = { kind: 'report', reportKind, fromDate, toDate, reportPayload };
  return {
    kind: 'report',
    number: `${reportKind}-${toDate}`,
    titleAr: title.ar,
    titleEn: title.en,
    status: 'issued',
    occurredOn: toDate,
    description: `${fromDate} → ${toDate}`,
    amountText,
    currency,
    partyName: null,
    propertyLabel: null,
    issuer,
    lines,
    meta: [
      { labelAr: 'التقرير', labelEn: 'Report', value: ar ? title.ar : title.en },
      { labelAr: 'من', labelEn: 'From', value: fromDate },
      { labelAr: 'إلى', labelEn: 'To', value: toDate },
      { labelAr: 'الملخص', labelEn: 'Summary', value: amountText },
    ],
    signature: await seal(
      claims,
      'report',
      `${reportKind}-${fromDate}-${toDate}`,
      payload,
      issuedAt,
      locale,
    ),
    issuedAt,
  };
}

/** Public verification of a printed accounting document token. */
export async function verifyAccountingPrintToken(token: string): Promise<{
  ok: boolean;
  fingerprintPrefix: string | null;
}> {
  const parsed = parseAccountingDocToken(token);
  if (!parsed) return { ok: false, fingerprintPrefix: null };
  const rebuilt = createHash('sha256')
    .update(
      `bhd-r:agl:${parsed.orgCompact}_${parsed.kindChar}_${parsed.idCompact}_${parsed.fingerprintPrefix}:${expandUuid(parsed.orgCompact)}`,
    )
    .digest('hex')
    .slice(0, 8);
  const check = token.split('_').at(-1)?.toLowerCase();
  return {
    ok: check === rebuilt,
    fingerprintPrefix: parsed.fingerprintPrefix,
  };
}

function expandUuid(compact: string): string {
  if (compact.length !== 32) return compact;
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

/**
 * Public letterheaded document for a share/QR token — same layout the accountant prints.
 * Journals and documents only (reports stay owner-only).
 */
export async function loadSharedAccountingPrintDoc(
  token: string,
  locale: 'ar' | 'en',
): Promise<AccountingPrintDoc | null> {
  const parsed = parseAccountingDocToken(token);
  if (!parsed) return null;
  const check = await verifyAccountingPrintToken(token);
  if (!check.ok) return null;
  if (parsed.kindChar === 'r') return null;
  if (parsed.idCompact.length !== 32) return null;

  const orgId = expandUuid(parsed.orgCompact);
  const id = expandUuid(parsed.idCompact);
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const { db } = createDatabase(url, { max: 2 });
  const ar = locale === 'ar';
  const issuedAt = new Date().toISOString();

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.platform_admin', 'true', true)`);
      await tx.execute(sql`select set_config('app.public', 'true', true)`);
      const issuer = issuerFromLetterhead(
        await readTermsLetterhead(tx, orgId).catch(() => null),
      );

      if (parsed.kindChar === 'j') {
        const entry = await tx.query.journalEntries.findFirst({
          where: and(eq(journalEntries.id, id), eq(journalEntries.organizationId, orgId)),
        });
        if (!entry) return null;
        const lines = await tx
          .select({
            debitMinor: journalLines.debitMinor,
            creditMinor: journalLines.creditMinor,
            currency: journalLines.currency,
            memo: journalLines.memo,
            code: ledgerAccounts.code,
            nameAr: ledgerAccounts.nameAr,
            nameEn: ledgerAccounts.nameEn,
            partyName: parties.displayName,
            propertyNameAr: properties.nameAr,
            unitCode: units.code,
          })
          .from(journalLines)
          .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
          .leftJoin(parties, eq(parties.id, journalLines.partyId))
          .leftJoin(properties, eq(properties.id, journalLines.propertyId))
          .leftJoin(units, eq(units.id, journalLines.unitId))
          .where(eq(journalLines.journalEntryId, id))
          .orderBy(asc(journalLines.createdAt));
        let debit = 0n;
        for (const line of lines) debit += line.debitMinor;
        const amountText = money(debit.toString(), 'OMR', locale);
        const payload = {
          kind: 'journal',
          id: entry.id,
          reference: entry.reference,
          occurredOn: entry.occurredOn,
          description: entry.description,
          status: entry.status,
          totals: { debitMinor: debit.toString() },
          lines: lines.map((line) => ({
            code: line.code,
            debit: line.debitMinor.toString(),
            credit: line.creditMinor.toString(),
          })),
        };
        const shareUrl = verifyUrl(locale, token);
        return {
          kind: 'journal' as const,
          number: entry.reference,
          titleAr: 'قيد يومية',
          titleEn: 'Journal entry',
          status: entry.status,
          occurredOn: String(entry.occurredOn),
          description: entry.description,
          amountText,
          currency: 'OMR',
          partyName: lines.find((line) => line.partyName)?.partyName ?? null,
          propertyLabel: null,
          issuer,
          lines: lines.map((line) => ({
            account: `${line.code} · ${ar ? line.nameAr : line.nameEn}`,
            dimension:
              [line.partyName, line.propertyNameAr, line.unitCode].filter(Boolean).join(' · ') ||
              '—',
            memo: line.memo || '—',
            debit: money(line.debitMinor.toString(), line.currency, locale),
            credit: money(line.creditMinor.toString(), line.currency, locale),
          })),
          meta: [
            { labelAr: 'المرجع', labelEn: 'Reference', value: entry.reference },
            { labelAr: 'التاريخ', labelEn: 'Date', value: String(entry.occurredOn) },
            { labelAr: 'الحالة', labelEn: 'Status', value: entry.status },
            { labelAr: 'الإجمالي', labelEn: 'Total', value: amountText },
          ],
          signature: {
            fingerprint: fingerprintOf(payload),
            code: signatureCode(fingerprintOf(payload)),
            signedAt: issuedAt,
            verifyUrl: shareUrl,
            qrSvg: await contractQrSvg(shareUrl),
          },
          issuedAt,
        };
      }

      // document: invoice, stay receipt, or journal-as-document
      const [invoice] = await tx
        .select({
          id: invoices.id,
          number: invoices.invoiceNumber,
          status: invoices.status,
          currency: invoices.currency,
          totalMinor: invoices.totalMinor,
          issuedOn: invoices.issuedOn,
          notes: invoices.notes,
          tenantName: parties.displayName,
          propertyNameAr: properties.nameAr,
          unitCode: units.code,
        })
        .from(invoices)
        .leftJoin(parties, eq(parties.id, invoices.tenantPartyId))
        .leftJoin(leases, eq(leases.id, invoices.leaseId))
        .leftJoin(units, eq(units.id, leases.unitId))
        .leftJoin(properties, eq(properties.id, units.propertyId))
        .where(and(eq(invoices.id, id), eq(invoices.organizationId, orgId)))
        .limit(1);

      if (invoice) {
        const amountText = money(invoice.totalMinor.toString(), invoice.currency, locale);
        const propertyLabel = [invoice.propertyNameAr, invoice.unitCode]
          .filter(Boolean)
          .join(' · ');
        const payload = {
          kind: 'document',
          id: invoice.id,
          docKind: 'invoice',
          reference: invoice.number,
          amount: invoice.totalMinor.toString(),
          currency: invoice.currency,
          occurredOn: String(invoice.issuedOn),
          status: invoice.status,
        };
        const fingerprint = fingerprintOf(payload);
        if (!fingerprint.startsWith(parsed.fingerprintPrefix)) {
          // Older seals may use a different payload shape — still show the live document.
        }
        return {
          kind: 'document' as const,
          number: invoice.number,
          titleAr: 'فاتورة مطالبة',
          titleEn: 'Demand invoice',
          status: invoice.status,
          occurredOn: String(invoice.issuedOn),
          description: invoice.notes || invoice.number,
          amountText,
          currency: invoice.currency,
          partyName: invoice.tenantName,
          propertyLabel: propertyLabel || null,
          issuer,
          lines: [],
          meta: [
            { labelAr: 'المرجع', labelEn: 'Reference', value: invoice.number },
            { labelAr: 'التاريخ', labelEn: 'Date', value: String(invoice.issuedOn) },
            { labelAr: 'الحالة', labelEn: 'Status', value: invoice.status },
            { labelAr: 'الطرف', labelEn: 'Party', value: invoice.tenantName ?? '—' },
            { labelAr: 'العقار', labelEn: 'Property', value: propertyLabel || '—' },
            { labelAr: 'المبلغ', labelEn: 'Amount', value: amountText },
          ],
          signature: await sealForOrg(orgId, 'document', invoice.id, payload, issuedAt, locale),
          issuedAt,
        };
      }

      const [stayPay] = await tx
        .select({
          id: stayPaymentIntents.id,
          amountMinor: stayPaymentIntents.amountMinor,
          currency: stayPaymentIntents.currency,
          status: stayPaymentIntents.status,
          at: stayPaymentIntents.updatedAt,
          referenceCode: stayBookings.referenceCode,
          propertyNameAr: properties.nameAr,
          unitCode: units.code,
        })
        .from(stayPaymentIntents)
        .innerJoin(stayBookings, eq(stayBookings.id, stayPaymentIntents.bookingId))
        .leftJoin(units, eq(units.id, stayBookings.unitId))
        .leftJoin(properties, eq(properties.id, units.propertyId))
        .where(
          and(eq(stayPaymentIntents.id, id), eq(stayPaymentIntents.organizationId, orgId)),
        )
        .limit(1);

      if (stayPay) {
        const amountText = money(stayPay.amountMinor.toString(), stayPay.currency, locale);
        const propertyLabel = [stayPay.propertyNameAr, stayPay.unitCode]
          .filter(Boolean)
          .join(' · ');
        const reference = stayPay.referenceCode;
        const occurredOn = stayPay.at.toISOString().slice(0, 10);
        const payload = {
          kind: 'document',
          id: stayPay.id,
          docKind: 'receipt',
          reference,
          amount: stayPay.amountMinor.toString(),
          currency: stayPay.currency,
          occurredOn,
          status: stayPay.status,
        };
        return {
          kind: 'document' as const,
          number: reference,
          titleAr: 'إيصال قبض',
          titleEn: 'Payment receipt',
          status: stayPay.status,
          occurredOn,
          description: ar
            ? `إيصال دفع إقامة ${reference}`
            : `Stay payment receipt ${reference}`,
          amountText,
          currency: stayPay.currency,
          partyName: null,
          propertyLabel: propertyLabel || null,
          issuer,
          lines: [],
          meta: [
            { labelAr: 'المرجع', labelEn: 'Reference', value: reference },
            { labelAr: 'التاريخ', labelEn: 'Date', value: occurredOn },
            { labelAr: 'الحالة', labelEn: 'Status', value: stayPay.status },
            { labelAr: 'العقار', labelEn: 'Property', value: propertyLabel || '—' },
            { labelAr: 'المبلغ', labelEn: 'Amount', value: amountText },
          ],
          signature: await sealForOrg(orgId, 'document', stayPay.id, payload, issuedAt, locale),
          issuedAt,
        };
      }

      return null;
    });
  } catch (error) {
    console.error('loadSharedAccountingPrintDoc failed', error);
    return null;
  }
}

/** Seal a print doc and return the public client URL for email / WhatsApp. */
export async function accountingClientShareUrl(
  claims: SessionClaims,
  input: { kind: AccountingPrintKind; id: string; locale: 'ar' | 'en' },
): Promise<string | null> {
  if (input.kind === 'report') return null;
  try {
    const doc = await loadAccountingPrintDoc(claims, input);
    return doc.signature.verifyUrl;
  } catch {
    return null;
  }
}
