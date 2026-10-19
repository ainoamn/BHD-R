import 'server-only';
import { createHash } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '@bhd-r/db';
import { serverBrandedQrSvg } from '@/lib/qr-branded';
import { publicWebOrigin } from '@/lib/seo';

type Executor = Pick<Parameters<Parameters<Database['transaction']>[0]>[0], 'execute'>;

/**
 * Verification token printed in the contract's QR code: the contract id plus a
 * checksum derived from data that is never shown publicly, so ids alone cannot be
 * turned into verification links. No secret is involved, so printed codes keep
 * working across key rotations.
 */
export function contractVerifyToken(contractId: string, createdAt: Date): string {
  const checksum = createHash('sha256')
    .update(`bhd-r:contract-verify:${contractId.toLowerCase()}:${createdAt.toISOString()}`)
    .digest('hex')
    .slice(0, 10);
  return `${contractId.replace(/-/g, '').toLowerCase()}${checksum}`;
}

/** Contract id inside a token, or null when the token is malformed. */
export function contractIdFromToken(token: string): string | null {
  const match = token.toLowerCase().match(/^([0-9a-f]{32})[0-9a-f]{10}$/);
  if (!match) return null;
  const hex = match[1]!;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** No locale prefix: the site redirects the scanner to their own language. */
export function contractVerifyUrl(token: string): string {
  return `${publicWebOrigin()}/verify/${token}`;
}

/** Inline SVG of the QR code with the BHD mark in the middle (scales with CSS). */
export async function contractQrSvg(url: string): Promise<string> {
  return serverBrandedQrSvg(url, { dark: '#0b3d2a', light: '#ffffff' });
}

export function formatSignatureSerial(year: number, sequence: number): string {
  return `ES-${year}-${String(sequence).padStart(6, '0')}`;
}

/**
 * Reservation e-signatures joined the series at this moment. Earlier ones are numbered
 * as of it, so serials already printed on contracts keep their numbers.
 */
const RESERVATION_SERIES_FROM = '2026-10-12T17:30:00Z';

function resultRows<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as T[];
}

type NumberedRow = {
  kind: 'contract' | 'reservation';
  id: string;
  parent_id: string;
  signed_at: Date | string;
  serial_year: number | string;
  serial_no: number | string;
};

/**
 * One serial series per organisation and year (Muscat time) for every e-signature the
 * site records: contract signatures and rent/purchase reservation e-signs. Counted over
 * the whole organisation, so a tenant or guest reads the same numbers as the landlord.
 * Visibility is raised on the transaction while it runs: never await it alongside other
 * queries on the same transaction (e.g. inside `Promise.all`).
 */
async function numberedRows(tx: Executor, orgId: string, filter: SQL): Promise<NumberedRow[]> {
  const [previous] = resultRows<{ value: string | null }>(
    await tx.execute(sql`select current_setting('app.platform_admin', true) as value`),
  );
  await tx.execute(sql`select set_config('app.platform_admin', 'true', true)`);
  try {
    return resultRows<NumberedRow>(
      await tx.execute(sql`
        select kind, id::text as id, parent_id::text as parent_id, signed_at, serial_year, serial_no
        from (
          select
            kind,
            id,
            parent_id,
            signed_at,
            extract(year from signed_at at time zone 'Asia/Muscat')::int as serial_year,
            row_number() over (
              partition by extract(year from signed_at at time zone 'Asia/Muscat')
              order by ordered_at, kind, id
            )::int as serial_no
          from (
            select 'contract'::text as kind, id, contract_id as parent_id, signed_at, signed_at as ordered_at
            from contract_signatures
            where organization_id = ${orgId}
            union all
            select
              'reservation'::text,
              id,
              resource_id,
              occurred_at,
              greatest(occurred_at, ${RESERVATION_SERIES_FROM}::timestamptz)
            from workflow_events
            where organization_id = ${orgId}
              and resource_type = 'reservation'
              and event_type = 'reservation.esign_completed'
          ) signed
        ) numbered
        ${filter}
      `),
    );
  } finally {
    await tx.execute(
      sql`select set_config('app.platform_admin', ${previous?.value ?? 'false'}, true)`,
    );
  }
}

function serialOf(row: NumberedRow): string {
  return formatSignatureSerial(Number(row.serial_year), Number(row.serial_no));
}

async function numberedSignatures(
  tx: Executor,
  orgId: string,
  kind: 'contract' | 'reservation',
  parentId: string,
): Promise<Map<string, string>> {
  const rows = await numberedRows(tx, orgId, sql`where kind = ${kind} and parent_id = ${parentId}`);
  return new Map(rows.map((row) => [row.id, serialOf(row)]));
}

export type SignatureRegisterRow = {
  kind: 'contract' | 'reservation';
  id: string;
  /** The contract or the reservation the signature belongs to. */
  parentId: string;
  serial: string;
  signedAt: string;
};

/** The organisation's e-signatures with their serials, newest first. */
export async function signatureRegister(
  tx: Executor,
  orgId: string,
  limit: number,
): Promise<SignatureRegisterRow[]> {
  const rows = await numberedRows(
    tx,
    orgId,
    sql`order by serial_year desc, serial_no desc limit ${limit}`,
  );
  return rows.map((row) => ({
    kind: row.kind,
    id: row.id,
    parentId: row.parent_id,
    serial: serialOf(row),
    signedAt: new Date(row.signed_at).toISOString(),
  }));
}

/** Serial of each signature on one contract; signatures are append-only, so serials hold. */
export function signatureSerials(
  tx: Executor,
  orgId: string,
  contractId: string,
): Promise<Map<string, string>> {
  return numberedSignatures(tx, orgId, 'contract', contractId);
}

/** Serial of the customer's e-signature on a rent/purchase reservation, once signed. */
export async function reservationSignatureSerial(
  tx: Executor,
  orgId: string,
  reservationId: string,
): Promise<string | null> {
  const serials = await numberedSignatures(tx, orgId, 'reservation', reservationId);
  return serials.values().next().value ?? null;
}
