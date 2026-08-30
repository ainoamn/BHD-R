import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { WorkerConfig } from '../src/config.js';
import { createMediaProcessor } from '../src/media/processor.js';
import type { MalwareScanner } from '../src/media/scanner.js';
import type { StorageAdapter } from '../src/storage.js';

class MemoryStorage implements StorageAdapter {
  readonly privateObjects = new Map<string, Uint8Array>();
  readonly publicObjects = new Map<string, Uint8Array>();

  async get(_bucket: string, key: string): Promise<Uint8Array> {
    const value = this.privateObjects.get(key);
    if (!value) throw new Error('missing object');
    return value;
  }

  async putPrivate(key: string, body: Uint8Array): Promise<void> {
    this.privateObjects.set(key, body);
  }

  async putPublic(key: string, body: Uint8Array): Promise<void> {
    this.publicObjects.set(key, body);
  }

  async deletePrivate(key: string): Promise<void> {
    this.privateObjects.delete(key);
  }
}

const scanner: MalwareScanner = { scan: async () => ({ status: 'clean' }) };

const config = {
  S3_BUCKET_PRIVATE: 'private',
  MEDIA_MAX_BYTES: 5_000_000,
  MEDIA_SCAN_MODE: 'required',
} as WorkerConfig;

describe('media processor', () => {
  it('preserves a private original and emits watermarked AVIF/WebP public variants', async () => {
    const storage = new MemoryStorage();
    const input = await sharp({
      create: { width: 1800, height: 1200, channels: 3, background: '#d7c6a5' },
    })
      .jpeg()
      .toBuffer();
    storage.privateObjects.set('incoming/one.jpg', input);
    const process = createMediaProcessor(config, storage, scanner);
    const result = await process({
      correlationId: '3c14996b-2184-44b9-9cbb-a92cb40bc254',
      organizationId: 'e8a76f19-0661-4b77-aa1f-42c83fd8f779',
      propertyId: '3fc75b5d-2d87-4dd8-94bd-9dd672702a4e',
      sourceKey: 'incoming/one.jpg',
      expectedContentType: 'image/jpeg',
      expectedSize: input.byteLength,
    });

    expect(result.originalKey).toMatch(/^originals\//);
    expect(storage.privateObjects.has(result.originalKey)).toBe(true);
    expect(storage.privateObjects.has('incoming/one.jpg')).toBe(false);
    expect(storage.publicObjects.size).toBe(6);
    const formats = await Promise.all(
      [...storage.publicObjects.values()].map(
        async (bytes) => (await sharp(bytes).metadata()).format,
      ),
    );
    expect(formats.filter((format) => format === 'webp')).toHaveLength(3);
    expect(formats.filter((format) => format === 'heif')).toHaveLength(3);
  });

  it('still Sharp-encodes when MEDIA_SCAN_MODE is disabled', async () => {
    const disabled: MalwareScanner = {
      scan: async () => ({ status: 'unavailable', reason: 'Scanning disabled by configuration' }),
    };
    const storage = new MemoryStorage();
    const input = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#c9b896' },
    })
      .jpeg()
      .toBuffer();
    storage.privateObjects.set('incoming/disabled.jpg', input);
    const process = createMediaProcessor(
      { ...config, MEDIA_SCAN_MODE: 'disabled' },
      storage,
      disabled,
    );
    const result = await process({
      correlationId: '3c14996b-2184-44b9-9cbb-a92cb40bc255',
      organizationId: 'e8a76f19-0661-4b77-aa1f-42c83fd8f779',
      propertyId: '3fc75b5d-2d87-4dd8-94bd-9dd672702a4e',
      sourceKey: 'incoming/disabled.jpg',
      expectedContentType: 'image/jpeg',
      expectedSize: input.byteLength,
    });
    expect(result.variants.length).toBeGreaterThan(0);
    expect(storage.publicObjects.size).toBeGreaterThan(0);
  });

  it('still Sharp-encodes when MEDIA_SCAN_MODE is best-effort and scanner is unavailable', async () => {
    const flaky: MalwareScanner = {
      scan: async () => ({ status: 'unavailable', reason: 'ClamAV offline' }),
    };
    const storage = new MemoryStorage();
    const input = await sharp({
      create: { width: 640, height: 480, channels: 3, background: '#88aaaa' },
    })
      .png()
      .toBuffer();
    storage.privateObjects.set('incoming/best.jpg', input);
    const process = createMediaProcessor(
      { ...config, MEDIA_SCAN_MODE: 'best-effort' },
      storage,
      flaky,
    );
    const result = await process({
      correlationId: '3c14996b-2184-44b9-9cbb-a92cb40bc256',
      organizationId: 'e8a76f19-0661-4b77-aa1f-42c83fd8f779',
      propertyId: '3fc75b5d-2d87-4dd8-94bd-9dd672702a4e',
      sourceKey: 'incoming/best.jpg',
      expectedContentType: 'image/png',
      expectedSize: input.byteLength,
    });
    expect(result.originalKey).toMatch(/^originals\//);
    expect(result.variants.length).toBeGreaterThan(0);
  });
});
