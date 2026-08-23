import { PermanentJobError } from '../errors.js';

export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export function detectImageMime(bytes: Uint8Array): SupportedImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' &&
    Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export function assertSafeImage(
  bytes: Uint8Array,
  declaredMime: SupportedImageMime,
  maxBytes: number,
  declaredSize?: number,
): SupportedImageMime {
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
    throw new PermanentJobError(
      'MEDIA_SIZE_REJECTED',
      'The uploaded image is empty or exceeds the size limit',
    );
  }
  if (declaredSize !== undefined && declaredSize !== bytes.byteLength) {
    throw new PermanentJobError(
      'MEDIA_SIZE_MISMATCH',
      'The declared image size does not match the object',
    );
  }
  const detected = detectImageMime(bytes);
  if (detected === null || detected !== declaredMime) {
    throw new PermanentJobError(
      'MEDIA_TYPE_MISMATCH',
      'The declared image type does not match its magic bytes',
    );
  }
  return detected;
}
