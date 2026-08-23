import { describe, expect, it } from 'vitest';
import { PermanentJobError } from '../src/errors.js';
import { assertSafeImage, detectImageMime } from '../src/media/magic.js';

describe('image magic-byte validation', () => {
  it('detects supported formats without trusting the extension', () => {
    expect(detectImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBe('image/jpeg');
    expect(detectImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png',
    );
    expect(detectImageMime(Buffer.from('RIFF0000WEBP', 'ascii'))).toBe('image/webp');
  });

  it('rejects MIME confusion and oversized payloads', () => {
    expect(() => assertSafeImage(Uint8Array.from([0xff, 0xd8, 0xff]), 'image/png', 100)).toThrow(
      PermanentJobError,
    );
    expect(() => assertSafeImage(Uint8Array.from([0xff, 0xd8, 0xff]), 'image/jpeg', 2)).toThrow(
      PermanentJobError,
    );
  });
});
