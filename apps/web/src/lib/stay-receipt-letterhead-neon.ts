import 'server-only';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase } from '@bhd-r/db';
import { readTermsLetterhead } from '@/lib/booking-terms-neon';
import { contractQrSvg } from '@/lib/contract-verify';
import type { AccountingIssuer, AccountingSignature } from '@/lib/accounting-letterhead';
import { publicWebOrigin } from '@/lib/seo';

export type StayReceiptLetterhead = {
  issuer: AccountingIssuer;
  signature: AccountingSignature;
};

function fingerprintOf(payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify({ v: 1, payload }))
    .digest('hex');
}

function signatureCode(fingerprint: string): string {
  return fingerprint
    .slice(0, 16)
    .toUpperCase()
    .replace(/(.{4})(?=.)/g, '$1-');
}

/** Org letterhead + e-sign QR for a public stay receipt / confirmation. */
export async function loadStayReceiptLetterhead(input: {
  organizationId: string;
  referenceCode: string;
  docKind: 'payment' | 'confirmation' | 'deposit_refund';
  paymentId?: string | null;
  amountMinor?: string | null;
  locale: 'ar' | 'en';
  /** Path under the site origin for the QR verify link (defaults from docKind). */
  verifyPath?: string;
}): Promise<StayReceiptLetterhead | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const { db } = createDatabase(url, { max: 2 });
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.platform_admin', 'true', true)`);
      await tx.execute(sql`select set_config('app.public', 'true', true)`);
      const letterhead = await readTermsLetterhead(tx, input.organizationId).catch(() => null);
      const issuer: AccountingIssuer = {
        nameAr: letterhead?.nameAr || 'BHD R',
        nameEn: letterhead?.nameEn || letterhead?.nameAr || 'BHD R',
        logoDataUrl: letterhead?.logoDataUrl ?? null,
        phone: letterhead?.phone ?? '',
        email: letterhead?.email ?? '',
        registrationNumber: letterhead?.registrationNumber ?? '',
      };
      const payload = {
        kind: 'stay_receipt',
        reference: input.referenceCode,
        docKind: input.docKind,
        paymentId: input.paymentId ?? null,
        amountMinor: input.amountMinor ?? null,
        orgId: input.organizationId,
      };
      const fingerprint = fingerprintOf(payload);
      const verifyPath =
        input.verifyPath ??
        (input.docKind === 'deposit_refund'
          ? `/${input.locale}/stays/booking/deposit-docs?ref=${encodeURIComponent(input.referenceCode)}&doc=refund`
          : `/${input.locale}/stays/booking/receipt?ref=${encodeURIComponent(input.referenceCode)}${
              input.docKind === 'payment' && input.paymentId
                ? `&doc=payment&pay=${encodeURIComponent(input.paymentId)}`
                : `&doc=${input.docKind}`
            }`);
      const verifyUrl = `${publicWebOrigin()}${verifyPath}`;
      return {
        issuer,
        signature: {
          fingerprint,
          code: signatureCode(fingerprint),
          signedAt: new Date().toISOString(),
          verifyUrl,
          qrSvg: await contractQrSvg(verifyUrl),
        },
      };
    });
  } catch (error) {
    console.error('loadStayReceiptLetterhead failed', error);
    return null;
  }
}

/** Ensure org id is on the booking projection when available. */
export function stayOrgIdOf(booking: { organizationId?: string | null }): string | null {
  return booking.organizationId ?? null;
}
