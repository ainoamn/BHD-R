import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';

type Bucket = { timestamps: number[] };

const globalStore = globalThis as unknown as { __bhdRRouteRateLimit?: Map<string, Bucket> };

function store(): Map<string, Bucket> {
  if (!globalStore.__bhdRRouteRateLimit) {
    globalStore.__bhdRRouteRateLimit = new Map();
  }
  return globalStore.__bhdRRouteRateLimit;
}

/** Best-effort in-memory sliding window (per isolate on serverless). */
export function assertRouteRateLimit(input: {
  key: string;
  limit: number;
  windowMs: number;
}): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const buckets = store();
  const bucket = buckets.get(input.key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((ts) => now - ts < input.windowMs);
  if (bucket.timestamps.length >= input.limit) {
    const oldest = bucket.timestamps[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((input.windowMs - (now - oldest)) / 1000));
    buckets.set(input.key, bucket);
    return { ok: false, retryAfterSec };
  }
  bucket.timestamps.push(now);
  buckets.set(input.key, bucket);
  return { ok: true };
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim().slice(0, 64);
  return request.headers.get('x-real-ip')?.trim().slice(0, 64) || 'unknown';
}

/** Fail-closed cron Authorization: Bearer <CRON_SECRET>. */
export function assertCronAuthorized(request: Request):
  | { ok: true }
  | { ok: false; status: number; error: string } {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) {
    return { ok: false, status: 503, error: 'cron_unconfigured' };
  }
  const auth = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const left = Buffer.from(auth);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }
  return { ok: true };
}

export function hashRateKey(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}
