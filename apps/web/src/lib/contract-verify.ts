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

/** Inline SVG of the QR code (dark modules only, scales with CSS). */
export async function contractQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#0b3d2a', light: '#ffffff' },
  });
}

export function formatSignatureSerial(year: number, sequence: number): string {
  return `ES-${year}-${String(sequence).padStart(6, '0')}`;
}

/**
 * Electronic-signature serial numbers for one contract's signatures: the order of
 * every signature the organisation recorded in that year (Muscat time). Signatures
 * are append-only, so a serial never changes once issued.
 */
export async function signatureSerials(
  tx: Executor,
  orgId: string,
  contractId: string,
): Promise<Map<string, string>> {
  const result = await tx.execute(sql`
    select id::text as id, serial_year, serial_no
    from (
      select
        id,
        contract_id,
        extract(year from signed_at at time zone 'Asia/Muscat')::int as serial_year,
        row_number() over (
          partition by extract(year from signed_at at time zone 'Asia/Muscat')
          order by signed_at, id
        )::int as serial_no
      from contract_signatures
      where organization_id = ${orgId}
    ) numbered
    where contract_id = ${contractId}
  `);
  const rows = (
    Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ id: string; serial_year: number | string; serial_no: number | string }>;
  return new Map(
    rows.map((row) => [
      row.id,
      formatSignatureSerial(Number(row.serial_year), Number(row.serial_no)),
    ]),
  );
}
