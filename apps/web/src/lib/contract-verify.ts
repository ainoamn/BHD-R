import 'server-only';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import type { Database } from '@bhd-r/db';
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

/** Paths of `public/brand/bhd-official-symbol.svg` (viewBox 548 × 171). */
const BRAND_MARK = `<g fill="#08a39f"><path d="M0 0h100c31 0 48 17 48 43 0 18-9 31-25 39 20 6 31 22 31 42 0 28-21 47-53 47H30v-28h70c16 0 26-8 26-20 0-13-11-22-29-22H0V74h97c15 0 24-8 24-21 0-15-10-25-25-25H28L0 0Z"/><path d="M385 0h74c52 0 89 35 89 85 0 51-37 86-89 86h-74l28-28h46c36 0 61-23 61-58 0-34-25-57-61-57h-46L385 0Z"/></g><path fill="#174b70" d="M190 109l30-27h90V0h30v171h-30v-62h-90v62h-30v-62Z"/>`;

/**
 * Brand mark on a white plate in the middle of the code. The plate hides about 6% of
 * the modules, well inside what level Q error correction (25%) restores.
 */
function withBrandMark(svg: string): string {
  const size = Number(svg.match(/viewBox="0 0 (\d+) \d+"/)?.[1]);
  if (!size) return svg;
  const markW = size * 0.36;
  const markH = markW * (171 / 548);
  const plateW = markW + size * 0.05;
  const plateH = markH + size * 0.05;
  const r = (value: number) => Math.round(value * 100) / 100;
  const plate =
    `<rect x="${r((size - plateW) / 2)}" y="${r((size - plateH) / 2)}" width="${r(plateW)}" height="${r(plateH)}" rx="${r(size * 0.02)}" fill="#ffffff"/>` +
    `<svg x="${r((size - markW) / 2)}" y="${r((size - markH) / 2)}" width="${r(markW)}" height="${r(markH)}" viewBox="0 0 548 171" shape-rendering="geometricPrecision">${BRAND_MARK}</svg>`;
  return svg.replace(/<\/svg>\s*$/, `${plate}</svg>`);
}

/** Inline SVG of the QR code with the BHD mark in the middle (scales with CSS). */
export async function contractQrSvg(url: string): Promise<string> {
  const svg = await QRCode.toString(url, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'Q',
    color: { dark: '#0b3d2a', light: '#ffffff' },
  });
  return withBrandMark(svg);
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

/**
 * One serial series per organisation and year (Muscat time) for every e-signature the
 * site records: contract signatures and rent/purchase reservation e-signs. Counted over
 * the whole organisation, so a tenant or guest reads the same numbers as the landlord.
 * Visibility is raised on the transaction while it runs: never await it alongside other
 * queries on the same transaction (e.g. inside `Promise.all`).
 */
async function numberedSignatures(
  tx: Executor,
  orgId: string,
  kind: 'contract' | 'reservation',
  parentId: string,
): Promise<Map<string, string>> {
  const [previous] = resultRows<{ value: string | null }>(
    await tx.execute(sql`select current_setting('app.platform_admin', true) as value`),
  );
  await tx.execute(sql`select set_config('app.platform_admin', 'true', true)`);
  try {
    const rows = resultRows<{
      id: string;
      serial_year: number | string;
      serial_no: number | string;
    }>(
      await tx.execute(sql`
        select id::text as id, serial_year, serial_no
        from (
          select
            kind,
            id,
            parent_id,
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
        where kind = ${kind} and parent_id = ${parentId}
      `),
    );
    return new Map(
      rows.map((row) => [
        row.id,
        formatSignatureSerial(Number(row.serial_year), Number(row.serial_no)),
      ]),
    );
  } finally {
    await tx.execute(
      sql`select set_config('app.platform_admin', ${previous?.value ?? 'false'}, true)`,
    );
  }
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
