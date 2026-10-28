import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Viewing visit pass: sealed QR token naming the viewing, plus a short gate username
 * and a fixed six-digit PIN issued when the owner schedules the visit.
 * Username is a short code (like the handover manual code), never the long WEB-… reference.
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sealKey(): Buffer {
  const base = process.env.BHD_R_SESSION_SECRET?.trim();
  if (!base || base.length < 32) throw new Error('viewing_pass_unconfigured');
  return Buffer.from(hkdfSync('sha256', base, 'bhd-r', 'viewing-visit-pass-v1', 32));
}

function uuidBytes(id: string): Buffer {
  return Buffer.from(id.replaceAll('-', ''), 'hex');
}

function bytesUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function randomViewingPin(): string {
  return String(randomBytes(3).readUIntBE(0, 3) % 1_000_000).padStart(6, '0');
}

/** Short typed username for the guard desk — `V` + six digits (handover-style length). */
export function randomViewingUsername(): string {
  return `V${randomViewingPin()}`;
}

/** Sealed token embedded in the guest QR; valid until `expiresAt` (unix seconds in payload). */
export function issueViewingPassToken(viewingId: string, expiresAt: Date): string {
  if (!UUID.test(viewingId)) throw new Error('invalid_viewing');
  const plain = Buffer.alloc(20);
  uuidBytes(viewingId).copy(plain, 0);
  plain.writeUInt32BE(Math.floor(expiresAt.getTime() / 1000), 16);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', sealKey(), iv);
  const sealed = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, sealed, cipher.getAuthTag()]).toString('base64url');
}

/** Viewing id from a scanned token, or null when forged/expired. */
export function openViewingPassToken(token: string, now: Date = new Date()): string | null {
  if (!/^[A-Za-z0-9_-]{40,120}$/.test(token)) return null;
  const raw = Buffer.from(token, 'base64url');
  if (raw.length !== IV_BYTES + 20 + TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', sealKey(), raw.subarray(0, IV_BYTES));
    decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
    const plain = Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)),
      decipher.final(),
    ]);
    const expiresSec = plain.readUInt32BE(16);
    if (now.getTime() / 1000 > expiresSec) return null;
    return bytesUuid(plain.subarray(0, 16));
  } catch {
    return null;
  }
}

/** Optional HMAC fingerprint of username+pin for logging (not used as the PIN itself). */
export function viewingPassFingerprint(username: string, pin: string): string {
  const base = process.env.BHD_R_SESSION_SECRET?.trim() ?? 'bhd-r';
  return createHmac('sha256', base).update(`${username}:${pin}`).digest('hex').slice(0, 12);
}
