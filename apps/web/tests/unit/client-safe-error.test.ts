import { describe, expect, it } from 'vitest';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';

describe('clientSafeErrorCode', () => {
  it('keeps known domain codes', () => {
    expect(clientSafeErrorCode(new Error('forbidden'))).toBe('forbidden');
    expect(clientSafeErrorCode(new Error('unit_unavailable'))).toBe('unit_unavailable');
  });

  it('redacts raw driver / SQL messages', () => {
    expect(clientSafeErrorCode(new Error('column "serial_number" does not exist'))).toBe(
      'request_failed',
    );
    expect(clientSafeErrorCode(new Error('42703'))).toBe('request_failed');
    expect(clientSafeErrorCode(new Error('password authentication failed'))).toBe(
      'request_failed',
    );
  });

  it('maps statuses', () => {
    expect(statusForSafeCode('forbidden')).toBe(403);
    expect(statusForSafeCode('rate_limited')).toBe(429);
    expect(statusForSafeCode('request_failed')).toBe(500);
  });
});
