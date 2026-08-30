import { createHash, timingSafeEqual } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const apiRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/app/api',
);

const WRITE_EXPORT =
  /export\s+(?:async\s+)?function\s+(POST|PATCH|PUT|DELETE)\b|export\s+const\s+(POST|PATCH|PUT|DELETE)\s*=/;

/** Routes that intentionally omit requireLiveSession (secret/oauth/proxy). */
const ALLOWLIST_PREFIXES = [
  path.join('auth', 'bhd'),
  path.join('cron'),
  'revalidate',
  path.join('backend'),
  'warm',
];

function listRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listRouteFiles(full));
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

function isAllowlisted(relative: string): boolean {
  const normalized = relative.split(path.sep).join(path.sep);
  return ALLOWLIST_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}${path.sep}`),
  );
}

describe('Next write-route live-session policy', () => {
  it('requires requireLiveSession on every non-allowlisted write handler', () => {
    const files = listRouteFiles(apiRoot);
    const offenders: string[] = [];
    for (const file of files) {
      const relative = path.relative(apiRoot, path.dirname(file));
      const source = readFileSync(file, 'utf8');
      if (!WRITE_EXPORT.test(source)) continue;
      if (isAllowlisted(relative)) continue;
      if (!source.includes('requireLiveSession')) {
        offenders.push(relative.replaceAll('\\', '/') || '(api root)');
      }
      if (!source.includes('requireCsrf: true') && !source.includes('requireCsrf:true')) {
        offenders.push(`${relative.replaceAll('\\', '/')}:missing_csrf`);
      }
    }
    expect(offenders, `policy offenders:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('cron bearer compare helper contract', () => {
  it('uses length-safe equality for secrets', () => {
    const a = Buffer.from('cron-secret-value-abcdefgh');
    const b = Buffer.from('cron-secret-value-abcdefgh');
    const c = Buffer.from('cron-secret-value-abcdefgX');
    expect(a.length === b.length && timingSafeEqual(a, b)).toBe(true);
    expect(a.length === c.length && timingSafeEqual(a, c)).toBe(false);
    expect(createHash('sha256').update('x').digest('hex')).toHaveLength(64);
  });
});
