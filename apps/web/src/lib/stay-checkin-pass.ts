import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Guest stay arrival pass: sealed QR + 6-digit code for staff to scan at check-in
 * (same pattern as lease handover / viewing gate).
 */

export const STAY_CHECKIN_PASS_WINDOW_MS = 5 * 60_000;
export const STAY_CHECKIN_PASS_WINDOWS = 4;

const IV_BYTES = 12;
const TAG_BYTES = 16;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function keys(): { seal: Buffer; code: Buffer } {
  const base = process.env.BHD_R_SESSION_SECRET?.trim();
  if (!base || base.length < 32) throw new Error('stay_checkin_pass_unconfigured');
  const material = Buffer.from(hkdfSync('sha256', base, 'bhd-r', 'stay-checkin-pass-v1', 64));
  return { seal: material.subarray(0, 32), code: material.subarray(32) };
}

export function stayCheckinPassWindow(now: Date = new Date()): number {
  return Math.floor(now.getTime() / STAY_CHECKIN_PASS_WINDOW_MS);
}

function windowValid(window: number, now: Date): boolean {
  const current = stayCheckinPassWindow(now);
  return window <= current && window > current - STAY_CHECKIN_PASS_WINDOWS;
}

function uuidBytes(id: string): Buffer {
  return Buffer.from(id.replaceAll('-', ''), 'hex');
}

function bytesUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function passCode(bookingId: string, window: number): string {
  const mac = createHmac('sha256', keys().code)
    .update(`${bookingId.toLowerCase()}:${window}`)
    .digest();
  return String(mac.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

export type StayCheckinPass = {
  token: string;
  code: string;
  expiresAt: string;
  refreshAt: string;
};

export function issueStayCheckinPass(bookingId: string, now: Date = new Date()): StayCheckinPass {
  if (!UUID.test(bookingId)) throw new Error('invalid_booking');
  const window = stayCheckinPassWindow(now);
  const plain = Buffer.alloc(20);
  uuidBytes(bookingId).copy(plain, 0);
  plain.writeUInt32BE(window, 16);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keys().seal, iv);
  const sealed = Buffer.concat([cipher.update(plain), cipher.final()]);
  const token = Buffer.concat([iv, sealed, cipher.getAuthTag()]).toString('base64url');
  return {
    token,
    code: passCode(bookingId, window),
    expiresAt: new Date(
      (window + STAY_CHECKIN_PASS_WINDOWS) * STAY_CHECKIN_PASS_WINDOW_MS,
    ).toISOString(),
    refreshAt: new Date((window + 1) * STAY_CHECKIN_PASS_WINDOW_MS).toISOString(),
  };
}

export function openStayCheckinPass(token: string, now: Date = new Date()): string | null {
  if (!/^[A-Za-z0-9_-]{40,120}$/.test(token)) return null;
  const raw = Buffer.from(token, 'base64url');
  if (raw.length !== IV_BYTES + 20 + TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', keys().seal, raw.subarray(0, IV_BYTES));
    decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
    const plain = Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)),
      decipher.final(),
    ]);
    if (!windowValid(plain.readUInt32BE(16), now)) return null;
    return bytesUuid(plain.subarray(0, 16));
  } catch {
    return null;
  }
}

export function verifyStayCheckinCode(
  bookingId: string,
  code: string,
  now: Date = new Date(),
): boolean {
  if (!UUID.test(bookingId) || !/^\d{6}$/.test(code)) return false;
  const current = stayCheckinPassWindow(now);
  for (let window = current; window > current - STAY_CHECKIN_PASS_WINDOWS; window -= 1) {
    if (passCode(bookingId, window) === code) return true;
  }
  return false;
}
