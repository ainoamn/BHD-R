import sharp from 'sharp';

const DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;

/** Longest edge and WebP quality, tried in order until the result fits the caller's limit. */
const STEPS = [
  [1600, 82],
  [1600, 72],
  [1280, 68],
  [1024, 60],
] as const;

/** The official BHD mark (public/brand/bhd-official-symbol.svg) in white, viewBox 548×171. */
const MARK_PATHS = `
  <path d="M0 0h100c31 0 48 17 48 43 0 18-9 31-25 39 20 6 31 22 31 42 0 28-21 47-53 47H30v-28h70c16 0 26-8 26-20 0-13-11-22-29-22H0V74h97c15 0 24-8 24-21 0-15-10-25-25-25H28L0 0Z"/>
  <path d="M385 0h74c52 0 89 35 89 85 0 51-37 86-89 86h-74l28-28h46c36 0 61-23 61-58 0-34-25-57-61-57h-46L385 0Z"/>
  <path d="M190 109l30-27h90V0h30v171h-30v-62h-90v62h-30v-62Z"/>`;

/** The gallery's `.media-watermark` badge, baked at the bottom inline-end corner of an RTL page. */
function watermark(width: number, height: number): Buffer {
  const markW = Math.round(Math.min(200, Math.max(64, width * 0.14)));
  const markH = Math.round((markW * 171) / 548);
  const padX = Math.round(markW * 0.16);
  const padY = Math.round(markH * 0.38);
  const margin = Math.max(8, Math.round(Math.min(width, height) * 0.025));
  const badgeW = markW + padX * 2;
  const badgeH = markH + padY * 2;
  const top = height - badgeH - margin;
  const radius = Math.round(badgeH * 0.28);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect x="${margin}" y="${top}" width="${badgeW}" height="${badgeH}" rx="${radius}"
        fill="#092D24" fill-opacity="0.45" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="1.5"/>
      <svg x="${margin + padX}" y="${top + padY}" width="${markW}" height="${markH}" viewBox="0 0 548 171">
        <g fill="#FFFFFF" fill-opacity="0.92">${MARK_PATHS}</g>
      </svg>
    </svg>`,
  );
}

/**
 * A user-uploaded photo as a compact WebP data URL carrying the platform mark: upright,
 * longest edge at most 1600px, no longer than `maxChars`. Falls back to the original
 * when the image cannot be decoded, so an upload never fails here.
 */
export async function brandUploadedPhoto(dataUrl: string, maxChars: number): Promise<string> {
  const match = DATA_URL.exec(dataUrl);
  if (!match) return dataUrl;
  const input = Buffer.from(match[1]!, 'base64');
  try {
    for (const [edge, quality] of STEPS) {
      const { data, info } = await sharp(input, { failOn: 'none', limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (info.width < 80 || info.height < 80) return dataUrl;
      const output = await sharp(data, {
        raw: { width: info.width, height: info.height, channels: info.channels },
      })
        .composite([{ input: watermark(info.width, info.height), top: 0, left: 0 }])
        .webp({ quality, effort: 4, smartSubsample: true })
        .toBuffer();
      const branded = `data:image/webp;base64,${output.toString('base64')}`;
      if (branded.length <= maxChars) return branded;
    }
  } catch {
    return dataUrl;
  }
  return dataUrl;
}
