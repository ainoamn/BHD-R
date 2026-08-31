import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

let logoSvgCache: Buffer | null = null;

async function loadLogoSvg(): Promise<Buffer> {
  if (logoSvgCache) return logoSvgCache;
  const path = join(process.cwd(), 'public', 'brand', 'bhd-official-symbol.svg');
  logoSvgCache = await readFile(path);
  return logoSvgCache;
}

/**
 * Bake the official BHD mark into image bytes so downloads keep the watermark
 * (CSS overlays alone are stripped on Save image).
 */
export async function bakeBrandWatermark(
  bytes: Buffer,
  mimeType: string,
): Promise<{ bytes: Buffer; mimeType: string }> {
  try {
    const base = sharp(bytes, { failOn: 'none', limitInputPixels: 40_000_000 }).rotate();
    const meta = await base.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width < 80 || height < 80) return { bytes, mimeType };

    const markW = Math.max(88, Math.min(220, Math.round(width * 0.16)));
    const markH = Math.max(28, Math.round(markW * (171 / 548)));
    const padX = Math.max(10, Math.round(markW * 0.12));
    const padY = Math.max(8, Math.round(markH * 0.22));
    const badgeW = markW + padX * 2;
    const badgeH = markH + padY * 2;
    const left = Math.max(10, width - badgeW - Math.round(width * 0.02));
    const top = Math.max(10, height - badgeH - Math.round(height * 0.02));

    const logoPng = await sharp(await loadLogoSvg())
      .resize({ width: markW, withoutEnlargement: false })
      .png()
      .toBuffer();

    const badge = Buffer.from(
      `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect x="${left}" y="${top}" width="${badgeW}" height="${badgeH}" rx="10" fill="#092D24" fill-opacity="0.55"/>
      </svg>`,
    );

    const composited = await sharp(bytes, { failOn: 'none', limitInputPixels: 40_000_000 })
      .rotate()
      .composite([
        { input: badge, top: 0, left: 0 },
        { input: logoPng, top: top + padY, left: left + padX },
      ])
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();

    return { bytes: composited, mimeType: 'image/jpeg' };
  } catch {
    return { bytes, mimeType };
  }
}
