import 'server-only';
import sharp from 'sharp';

const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|jpg|webp|heic|heif);base64,([A-Za-z0-9+/=]+)$/;
const PDF_DATA_URL = /^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/;

function fail(code: string): never {
  throw new Error(code);
}

/** A square WebP avatar or logo, 320px, with metadata (location, camera) stripped. */
export async function squareAvatar(dataUrl: string): Promise<string> {
  const match = IMAGE_DATA_URL.exec(dataUrl);
  if (!match) fail('avatar_invalid');
  try {
    const output = await sharp(Buffer.from(match[1]!, 'base64'), {
      failOn: 'none',
      limitInputPixels: 40_000_000,
    })
      .rotate()
      .resize({ width: 320, height: 320, fit: 'cover', position: 'attention' })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
    return `data:image/webp;base64,${output.toString('base64')}`;
  } catch {
    fail('avatar_invalid');
  }
}

/**
 * A verification document as stored: photos re-encoded to WebP (upright, metadata stripped,
 * longest edge ≤ 2000px) and shrunk until they fit; PDFs kept as uploaded after a signature check.
 */
export async function compactDocument(
  dataUrl: string,
  maxChars: number,
  allowPdf: boolean,
): Promise<{ dataUrl: string; mime: string }> {
  const pdf = PDF_DATA_URL.exec(dataUrl);
  if (pdf) {
    if (!allowPdf || dataUrl.length > maxChars) fail('verification_invalid');
    if (!Buffer.from(pdf[1]!.slice(0, 16), 'base64').toString('latin1').startsWith('%PDF'))
      fail('verification_invalid');
    return { dataUrl, mime: 'application/pdf' };
  }
  const match = IMAGE_DATA_URL.exec(dataUrl);
  if (!match) fail('verification_invalid');
  const input = Buffer.from(match[1]!, 'base64');
  for (const [edge, quality] of [
    [2000, 82],
    [1600, 76],
    [1280, 70],
    [1024, 64],
  ] as const) {
    let output: Buffer;
    try {
      output = await sharp(input, { failOn: 'none', limitInputPixels: 60_000_000 })
        .rotate()
        .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
        .webp({ quality, effort: 4 })
        .toBuffer();
    } catch {
      fail('verification_invalid');
    }
    const encoded = `data:image/webp;base64,${output.toString('base64')}`;
    if (encoded.length <= maxChars) return { dataUrl: encoded, mime: 'image/webp' };
  }
  fail('verification_invalid');
}

export function decodeDataUrl(dataUrl: string): { mime: string; bytes: Buffer } | null {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1]!.toLowerCase(), bytes: Buffer.from(match[2]!, 'base64') };
}
