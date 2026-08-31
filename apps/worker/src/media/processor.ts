import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import type { WorkerConfig } from '../config.js';
import { PermanentJobError } from '../errors.js';
import type { StorageAdapter } from '../storage.js';
import type { MediaJob } from '../types.js';
import { assertSafeImage } from './magic.js';
import type { MalwareScanner } from './scanner.js';

const VARIANT_WIDTHS = [480, 960, 1600] as const;
const MAX_PIXELS = 40_000_000;

const WORKER_DIR = dirname(fileURLToPath(import.meta.url));
const LOGO_CANDIDATES = [
  join(WORKER_DIR, '../../../../web/public/brand/bhd-official-symbol.svg'),
  join(process.cwd(), 'apps/web/public/brand/bhd-official-symbol.svg'),
  join(process.cwd(), 'public/brand/bhd-official-symbol.svg'),
];

function loadLogoSvg(): Buffer | null {
  for (const path of LOGO_CANDIDATES) {
    try {
      return readFileSync(path);
    } catch {
      /* try next */
    }
  }
  return null;
}

async function brandWatermarkOverlay(width: number, height: number): Promise<Buffer> {
  const markW = Math.max(88, Math.min(220, Math.round(width * 0.16)));
  const markH = Math.max(28, Math.round(markW * (171 / 548)));
  const padX = Math.max(10, Math.round(markW * 0.12));
  const padY = Math.max(8, Math.round(markH * 0.22));
  const badgeW = markW + padX * 2;
  const badgeH = markH + padY * 2;
  const left = Math.max(10, width - badgeW - Math.round(width * 0.02));
  const top = Math.max(10, height - badgeH - Math.round(height * 0.02));

  const logoSvg = loadLogoSvg();
  if (!logoSvg) {
    const safeText = 'BHD R';
    return Buffer.from(
      `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <g opacity="0.55">
          <rect x="${left}" y="${top}" width="${badgeW}" height="${badgeH}" rx="10" fill="#092D24"/>
          <text x="${left + badgeW / 2}" y="${top + badgeH * 0.66}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${Math.max(14, Math.round(badgeH * 0.42))}" font-weight="700" fill="#f4ead6">${safeText}</text>
        </g>
      </svg>`,
    );
  }

  const logoPng = await sharp(logoSvg).resize({ width: markW }).png().toBuffer();
  const badge = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${left}" y="${top}" width="${badgeW}" height="${badgeH}" rx="10" fill="#092D24" fill-opacity="0.55"/>
    </svg>`,
  );
  return sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: badge, top: 0, left: 0 },
      { input: logoPng, top: top + padY, left: left + padX },
    ])
    .png()
    .toBuffer();
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
      const mark = await brandWatermarkOverlay(resized.info.width, resized.info.height);
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
