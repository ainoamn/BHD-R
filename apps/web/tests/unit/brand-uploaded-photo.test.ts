import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { brandUploadedPhoto } from '@/lib/brand-uploaded-photo';

async function phonePhoto(width: number, height: number): Promise<string> {
  const noise = Buffer.alloc(width * height * 3);
  for (let i = 0; i < noise.length; i += 1) noise[i] = 120 + ((i * 7919) % 97);
  const jpeg = await sharp(noise, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

const bytesOf = (dataUrl: string) => Buffer.from(dataUrl.split(',')[1]!, 'base64');

async function meanOf(image: Buffer, left: number, top: number, size: number): Promise<number> {
  const { data } = await sharp(image)
    .extract({ left, top, width: size, height: size })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data.reduce((sum, value) => sum + value, 0) / data.length;
}

describe('brandUploadedPhoto', () => {
  it('shrinks a large photo to a WebP of at most 1600px within the limit', async () => {
    const source = await phonePhoto(3200, 2400);
    const branded = await brandUploadedPhoto(source, 2_000_000);
    expect(branded.startsWith('data:image/webp;base64,')).toBe(true);
    expect(branded.length).toBeLessThan(source.length);
    expect(branded.length).toBeLessThanOrEqual(2_000_000);
    const meta = await sharp(bytesOf(branded)).metadata();
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(1200);
  });

  it('bakes the platform badge into the bottom-left corner', async () => {
    const branded = bytesOf(await brandUploadedPhoto(await phonePhoto(1200, 900), 2_000_000));
    const badgeEdge = await meanOf(branded, 32, 900 - 40, 8);
    const opposite = await meanOf(branded, 1200 - 40, 32, 8);
    expect(Math.abs(badgeEdge - opposite)).toBeGreaterThan(25);
  });

  it('keeps small or unreadable images as they are', async () => {
    const tiny = await phonePhoto(40, 40);
    expect(await brandUploadedPhoto(tiny, 2_000_000)).toBe(tiny);
    const broken = 'data:image/png;base64,AAAA';
    expect(await brandUploadedPhoto(broken, 2_000_000)).toBe(broken);
  });
});
