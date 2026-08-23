import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { WorkerConfig } from '../config.js';
import { PermanentJobError } from '../errors.js';
import type { StorageAdapter } from '../storage.js';
import type { MediaJob } from '../types.js';
import { assertSafeImage } from './magic.js';
import type { MalwareScanner } from './scanner.js';

const VARIANT_WIDTHS = [480, 960, 1600] as const;
const MAX_PIXELS = 40_000_000;

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => {
    const replacements: Record<string, string> = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return replacements[character] ?? '';
  });
}

function watermarkSvg(text: string, width: number, height: number): Buffer {
  const safeText = escapeXml(text.slice(0, 48));
  const markWidth = Math.max(180, Math.min(420, Math.round(width * 0.48)));
  const markHeight = Math.max(52, Math.round(markWidth * 0.22));
  const fontSize = Math.max(16, Math.round(markHeight * 0.42));
  const x = Math.max(12, width - markWidth - 18);
  const y = Math.max(12, height - markHeight - 18);
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <g opacity="0.23">
        <rect x="${x}" y="${y}" width="${markWidth}" height="${markHeight}" rx="16" fill="#092D24"/>
        <text x="${x + markWidth / 2}" y="${y + markHeight * 0.64}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#f4ead6">${safeText}</text>
      </g>
    </svg>`,
  );
}

export interface MediaResult {
  originalKey: string;
  sha256: string;
  width: number;
  height: number;
  variants: Array<{
    key: string;
    width: number;
    height: number;
    bytes: number;
    format: 'avif' | 'webp';
    contentType: 'image/avif' | 'image/webp';
  }>;
}

export function createMediaProcessor(
  config: WorkerConfig,
  storage: StorageAdapter,
  scanner: MalwareScanner,
): (job: MediaJob) => Promise<MediaResult> {
  return async (job) => {
    const sourceBucket = job.sourceBucket ?? config.S3_BUCKET_PRIVATE;
    if (sourceBucket !== config.S3_BUCKET_PRIVATE) {
      throw new PermanentJobError(
        'MEDIA_SOURCE_BUCKET_REJECTED',
        'Only the private upload bucket is accepted',
      );
    }

    const bytes = await storage.get(sourceBucket, job.sourceKey);
    const mime = assertSafeImage(
      bytes,
      job.expectedContentType,
      config.MEDIA_MAX_BYTES,
      job.expectedSize,
    );
    const scan = await scanner.scan(bytes);
    if (scan.status === 'infected') {
      const quarantineKey = `quarantine/${job.organizationId}/${job.propertyId}/${Date.now()}`;
      await storage.putPrivate(quarantineKey, bytes, 'application/octet-stream', {
        reason: 'malware',
      });
      await storage.deletePrivate(job.sourceKey);
      throw new PermanentJobError(
        'MEDIA_MALWARE_DETECTED',
        `Upload quarantined: ${scan.signature}`,
      );
    }
    if (scan.status === 'unavailable' && config.MEDIA_SCAN_MODE === 'required') {
      throw new Error('Malware scanner is unavailable; upload will be retried');
    }

    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (job.expectedSha256 && job.expectedSha256 !== sha256) {
      throw new PermanentJobError(
        'MEDIA_HASH_MISMATCH',
        'The uploaded image does not match the declared checksum',
      );
    }
    const image = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'warning' }).rotate();
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      throw new PermanentJobError('MEDIA_DIMENSIONS_MISSING', 'Image dimensions could not be read');
    }

    const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
    const originalKey = `originals/${job.organizationId}/${job.propertyId}/${sha256}.${extension}`;
    await storage.putPrivate(originalKey, bytes, mime, { sha256, scan: scan.status });

    const variants: MediaResult['variants'] = [];
    for (const width of VARIANT_WIDTHS) {
      const resized = await sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'warning' })
        .rotate()
        .resize({ width, withoutEnlargement: true, fit: 'inside' })
        .toBuffer({ resolveWithObject: true });
      const mark = watermarkSvg(
        job.watermarkText ?? 'BHD R — A BHD Product',
        resized.info.width,
        resized.info.height,
      );
      const composited = await sharp(resized.data)
        .composite([{ input: mark }])
        .toBuffer();
      for (const format of ['avif', 'webp'] as const) {
        const variant = await (
          format === 'avif'
            ? sharp(composited).avif({ quality: 52, effort: 5 })
            : sharp(composited).webp({ quality: 82, effort: 5 })
        ).toBuffer({ resolveWithObject: true });
        const contentType = format === 'avif' ? 'image/avif' : 'image/webp';
        const actualWidth = variant.info.width;
        const key = `properties/${job.organizationId}/${job.propertyId}/${sha256}/${actualWidth}.${format}`;
        await storage.putPublic(key, variant.data, contentType, {
          sourceSha256: sha256,
          watermark: 'bhd-r',
          format,
        });
        variants.push({
          key,
          width: actualWidth,
          height: variant.info.height,
          bytes: variant.data.byteLength,
          format,
          contentType,
        });
      }
    }

    if (job.sourceKey !== originalKey) await storage.deletePrivate(job.sourceKey);
    return { originalKey, sha256, width: metadata.width, height: metadata.height, variants };
  };
}
