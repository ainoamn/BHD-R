import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import { users, workflowEvents } from '@bhd-r/db';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { contractQrSvg } from '@/lib/contract-verify';
import { elevatedTx } from '@/lib/elevated-db';
import {
  renderLeasingCsv,
  renderLeasingXlsx,
  type LeasingReportSheet,
} from '@/lib/leasing-report-files';
import type { LeasingPrintRow } from '@/lib/leasing-ops-table';
import { publicWebOrigin } from '@/lib/seo';

const TOKEN_RE = /^blr_[a-f0-9]{16}_[a-f0-9]{8}$/i;
const RESOURCE = 'leasing_ops_report';
const EVENT = 'leasing.report_issued';

export type LeasingReportSnapshot = {
  token: string;
  fingerprint: string;
  locale: 'ar' | 'en';
  title: string;
  issuedAt: string;
  byName: string | null;
  organizationId: string;
  rowCount: number;
  rows: LeasingPrintRow[];
};

function fail(code: string): never {
  const error = new Error(code);
  (error as Error & { code: string }).code = code;
  throw error;
}

/** Fixed key order — jsonb round-trips reorder keys and would otherwise break the seal. */
function normalizePrintRows(rows: unknown): LeasingPrintRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((raw) => {
    const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return {
      reference: String(row.reference ?? ''),
      property: String(row.property ?? ''),
      unit: String(row.unit ?? ''),
      owner: String(row.owner ?? ''),
      tenant: String(row.tenant ?? ''),
      state: String(row.state ?? ''),
      startsOn: String(row.startsOn ?? ''),
      endsOn: String(row.endsOn ?? ''),
      rent: String(row.rent ?? ''),
    };
  });
}

function fingerprintOf(rows: LeasingPrintRow[], issuedAt: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ v: 1, issuedAt, rows: normalizePrintRows(rows) }))
    .digest('hex');
}

function checkByte(fingerprint: string, organizationId: string, issuedAt: string): string {
  return createHash('sha256')
    .update(`bhd-r:leasing-report:${fingerprint}:${organizationId}:${issuedAt}`)
    .digest('hex')
    .slice(0, 8);
}

function makeToken(fingerprint: string, organizationId: string, issuedAt: string): string {
  return `blr_${fingerprint.slice(0, 16)}_${checkByte(fingerprint, organizationId, issuedAt)}`;
}

function sheetOf(snapshot: LeasingReportSnapshot): LeasingReportSheet {
  const ar = snapshot.locale === 'ar';
  return {
    title: snapshot.title,
    columns: ar
      ? ['العقد', 'المبنى', 'الوحدة', 'المالك', 'المستأجر', 'الحالة', 'البداية', 'النهاية', 'الإيجار']
      : [
          'Contract',
          'Building',
          'Unit',
          'Owner',
          'Tenant',
          'Status',
          'Starts',
          'Ends',
          'Rent',
        ],
    rows: snapshot.rows.map((row) => [
      row.reference,
      row.property,
      row.unit,
      row.owner,
      row.tenant,
      row.state,
      row.startsOn,
      row.endsOn,
      row.rent,
    ]),
  };
}

export function leasingReportVerifyUrl(token: string, locale: 'ar' | 'en' = 'ar'): string {
  return `${publicWebOrigin()}/${locale}/verify/leasing/${encodeURIComponent(token)}`;
}

export async function issueLeasingOpsReport(
  claims: SessionClaims,
  input: {
    locale: 'ar' | 'en';
    title: string;
    rows: LeasingPrintRow[];
  },
): Promise<{ token: string; verifyUrl: string; reportPath: string }> {
  if (!hasDatabaseUrl()) fail('db_unconfigured');
  if (!claims.organizationId || !hasPermission(claims, 'lease.read')) fail('forbidden');
  if (!input.rows.length || input.rows.length > 500) fail('invalid_body');

  const orgId = claims.organizationId;
  const issuedAt = new Date().toISOString();
  const rows = normalizePrintRows(input.rows);
  if (!rows.length) fail('invalid_body');
  const fingerprint = fingerprintOf(rows, issuedAt);
  const token = makeToken(fingerprint, orgId, issuedAt);
  const title =
    input.title.trim().slice(0, 120) ||
    (input.locale === 'ar' ? 'تقرير إدارة التأجير' : 'Leasing management report');

  const snapshot = await elevatedTx(async (tx) => {
    const [user] = await tx
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, claims.sub))
      .limit(1);
    const byName = user?.name?.trim() || null;
    const value: LeasingReportSnapshot = {
      token,
      fingerprint,
      locale: input.locale,
      title,
      issuedAt,
      byName,
      organizationId: orgId,
      rowCount: rows.length,
      rows,
    };
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: RESOURCE,
      resourceId: randomUUID(),
      eventType: EVENT,
      metadata: value,
    });
    return value;
  });

  return {
    token: snapshot.token,
    verifyUrl: leasingReportVerifyUrl(snapshot.token, input.locale),
    reportPath: `/${input.locale}/owner/leasing/report/${encodeURIComponent(snapshot.token)}`,
  };
}

export async function loadLeasingOpsReport(
  token: string,
): Promise<LeasingReportSnapshot | null> {
  if (!hasDatabaseUrl() || !TOKEN_RE.test(token)) return null;
  return elevatedTx(async (tx) => {
    const [match] = await tx
      .select({
        metadata: workflowEvents.metadata,
        organizationId: workflowEvents.organizationId,
      })
      .from(workflowEvents)
      .where(
        and(
          eq(workflowEvents.resourceType, RESOURCE),
          eq(workflowEvents.eventType, EVENT),
          sql`${workflowEvents.metadata}->>'token' = ${token}`,
        ),
      )
      .orderBy(desc(workflowEvents.occurredAt))
      .limit(1);

    if (!match?.metadata || typeof match.metadata !== 'object') return null;
    const snapshot = match.metadata as LeasingReportSnapshot;
    if (!snapshot.issuedAt || !snapshot.fingerprint) return null;
    const rows = normalizePrintRows(snapshot.rows);
    if (!rows.length) return null;
    const expected = makeToken(snapshot.fingerprint, match.organizationId, snapshot.issuedAt);
    if (expected !== token) return null;
    const recomputed = fingerprintOf(rows, snapshot.issuedAt);
    if (recomputed !== snapshot.fingerprint) return null;
    return {
      ...snapshot,
      rows,
      rowCount: rows.length,
      organizationId: match.organizationId,
    };
  });
}

export async function leasingReportFile(
  snapshot: LeasingReportSnapshot,
  format: 'xlsx' | 'csv',
): Promise<{ bytes: Uint8Array; filename: string; mime: string }> {
  const sheet = sheetOf(snapshot);
  const stamp = snapshot.issuedAt.slice(0, 10);
  if (format === 'csv') {
    return {
      bytes: renderLeasingCsv(sheet),
      filename: `bhd-r-leasing-${stamp}.csv`,
      mime: 'text/csv; charset=utf-8',
    };
  }
  return {
    bytes: renderLeasingXlsx(sheet),
    filename: `bhd-r-leasing-${stamp}.xlsx`,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

export async function leasingReportPresentation(snapshot: LeasingReportSnapshot) {
  const verifyUrl = leasingReportVerifyUrl(snapshot.token, snapshot.locale);
  const qrSvg = await contractQrSvg(verifyUrl);
  return { snapshot, verifyUrl, qrSvg };
}
