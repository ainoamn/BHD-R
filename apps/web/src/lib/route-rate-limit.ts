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
function assertMemoryRateLimit(input: {
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

/**
 * Shared Upstash Redis REST counter when configured (cross-instance).
 * Falls back to in-memory when UPSTASH_* env is absent.
 */
async function assertUpstashRateLimit(input: {
  key: string;
  limit: number;
  windowMs: number;
}): Promise<{ ok: true } | { ok: false; retryAfterSec: number } | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  const redisKey = `bhd-r:rl:${input.key}`;
  const windowSec = Math.max(1, Math.ceil(input.windowMs / 1000));
  try {
    const incr = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', redisKey],
        ['EXPIRE', redisKey, String(windowSec), 'NX'],
        ['TTL', redisKey],
      ]),
      signal: AbortSignal.timeout(2_500),
      cache: 'no-store',
    });
    if (!incr.ok) return null;
    const rows = (await incr.json()) as Array<{ result?: unknown }>;
    const count = Number(rows[0]?.result ?? 0);
    const ttl = Number(rows[2]?.result ?? windowSec);
    if (count > input.limit) {
      return { ok: false, retryAfterSec: Math.max(1, ttl > 0 ? ttl : windowSec) };
    }
    return { ok: true };
  } catch {
    return null;
  }
}

/** Prefer Upstash when configured; otherwise in-memory (per isolate). */
export async function assertRouteRateLimitAsync(input: {
  key: string;
  limit: number;
  windowMs: number;
}): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  const shared = await assertUpstashRateLimit(input);
  if (shared) return shared;
  return assertMemoryRateLimit(input);
}

/** Sync helper for callers that cannot await — memory only. Prefer async when possible. */
export function assertRouteRateLimit(input: {
  key: string;
  limit: number;
  windowMs: number;
}): { ok: true } | { ok: false; retryAfterSec: number } {
  return assertMemoryRateLimit(input);
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim().slice(0, 64);
  return request.headers.get('x-real-ip')?.trim().slice(0, 64) || 'unknown';
}

/** Fail-closed cron Authorization: Bearer <CRON_SECRET>. */
export function assertCronAuthorized(
  request: Request,
): { ok: true } | { ok: false; status: number; error: string } {
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
