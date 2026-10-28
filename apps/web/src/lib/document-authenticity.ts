import { createHmac } from 'node:crypto';

/** Fixed anti-forgery copy printed on every issued contract / addendum. */
export const DOCUMENT_ANTI_FORGERY = {
  titleAr: 'تحذير من التزوير',
  titleEn: 'Anti-forgery warning',
  bodyAr:
    'تحقق من صحة هذه الوثيقة فقط عبر الموقع الرسمي r.bhd-om.com (رمز QR أو رابط التحقق). أي موقع آخر يدّعي التحقق قد يكون مزيفاً. الوثيقة غير معتمدة إلا إذا ظهرت صالحة على النطاق الرسمي لـ BHD R.',
  bodyEn:
    'Verify this document only on the official site r.bhd-om.com (QR code or verify link). Any other “verification” site may be fake. The document is valid only if it shows as authentic on the official BHD R domain.',
} as const;

export function shortSeal(seal: string | null | undefined): string | null {
  if (!seal || seal.length < 16) return null;
  return `${seal.slice(0, 8)}…${seal.slice(-8)}`;
}

/**
 * Server-side digital seal over the document hash (HMAC).
 * Tamper-evident seal bound to BHD R secrets (not a public PKI certificate).
 */
export function contractDigitalSeal(documentHash: string | null | undefined): string | null {
  const hash = (documentHash ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  const secret =
    process.env.CONTRACT_SEAL_SECRET?.trim() ||
    process.env.FIELD_ENCRYPTION_KEY_V1?.trim() ||
    process.env.BHD_R_SESSION_SECRET?.trim() ||
    process.env.CSRF_SECRET?.trim() ||
    '';
  if (secret.length < 16) return null;
  return createHmac('sha256', secret).update(`bhd-r:doc-seal:v1:${hash}`).digest('hex');
}
