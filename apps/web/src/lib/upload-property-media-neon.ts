import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { DeleteObjectCommand, PutObjectCommand, S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { and, eq, sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import {
  createDatabase,
  mediaAssets,
  outboxEvents,
  propertyDocuments,
  unitMedia,
  units,
  type Database,
} from '@bhd-r/db';
import { isProductionRuntime } from '@/lib/runtime-env';

/** Transitional public promote after magic-bytes (not a malware scan). */
function mediaPromoteMode(): 'await_worker' | 'magic_bytes_best_effort' {
  const raw = process.env.MEDIA_PUBLIC_PROMOTE_MODE?.trim();
  if (raw === 'await_worker') return 'await_worker';
  if (raw === 'magic_bytes_best_effort') return 'magic_bytes_best_effort';
  // Default: keep public gallery usable when worker is cold/offline.
  return 'magic_bytes_best_effort';
}

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRPropertyWriteDb?: DbHandle };

const INLINE_MAX_BYTES = 2_500_000;

type InlineMeta = {
  purpose?: string;
  unitId?: string;
  via?: string;
  fileName?: string | null;
  storage?: string;
  dataBase64?: string;
};

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRPropertyWriteDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdRPropertyWriteDb = { db };
  }
  return globalForDb.__bhdRPropertyWriteDb;
}

function s3Configured(): boolean {
  return Boolean(
    process.env.S3_ENDPOINT?.trim() &&
      process.env.S3_ACCESS_KEY?.trim() &&
      process.env.S3_SECRET_KEY?.trim() &&
      !String(process.env.S3_ENDPOINT).includes('example.com'),
  );
}

/** Object storage is usable only when a real private bucket name is set (empty env breaks R2 puts). */
function s3BucketsReady(): boolean {
  return s3Configured() && Boolean(process.env.S3_BUCKET_PRIVATE?.trim());
}

function getS3(): S3Client {
  const endpoint = process.env.S3_ENDPOINT;
  if (!endpoint) throw new Error('s3_unconfigured');
  return new S3Client({
    region: process.env.S3_REGION?.trim() || 'auto',
    forcePathStyle: true,
    endpoint,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
  });
}

/** Sniff real file type — never trust client Content-Type alone (P0-03). */
export function detectAllowedMime(
  bytes: Buffer,
  purpose: 'property_image' | 'attachment',
): string | null {
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
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (purpose === 'attachment' && bytes.length >= 5 && bytes.toString('ascii', 0, 5) === '%PDF-') {
    return 'application/pdf';
  }
  return null;
}

async function withinTenant<T>(
  claims: SessionClaims,
  work: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select set_config('app.organization_id', ${claims.organizationId ?? ''}, true)`,
    );
    await transaction.execute(sql`select set_config('app.user_id', ${claims.sub}, true)`);
    await transaction.execute(
      sql`select set_config('app.party_id', ${claims.partyId ?? ''}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.platform_admin', ${String(claims.roles.includes('platform_admin'))}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.is_tenant', ${String(claims.roles.includes('tenant'))}, true)`,
    );
    await transaction.execute(sql`select set_config('app.public', 'false', true)`);
    return work(transaction);
  });
}

function extensionFor(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'application/pdf') return 'pdf';
  return 'jpg';
}

async function persistAssetRow(
  claims: SessionClaims,
  input: {
    unitId: string;
    purpose: 'property_image' | 'attachment';
    position: number;
    mimeType: string;
    bytes: Buffer;
    fileName?: string;
    objectKey: string;
    publicObjectKey: string | null;
    metadata: Record<string, unknown>;
  },
): Promise<string> {
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  return withinTenant(claims, async (transaction) => {
    const unit = await transaction.query.units.findFirst({
      where: and(
        eq(units.id, input.unitId),
        eq(units.organizationId, claims.organizationId!),
      ),
    });
    if (!unit) throw new Error('unit_not_found');

    const promote = mediaPromoteMode();
    const processingStatus = promote === 'magic_bytes_best_effort' ? 'ready' : 'queued';
    const scanStatus = promote === 'magic_bytes_best_effort' ? 'clean' : 'pending';
    const rows = await transaction
      .insert(mediaAssets)
      .values({
        organizationId: claims.organizationId!,
        uploadedByUserId: claims.sub,
        privateObjectKey: input.objectKey,
        publicObjectKey: input.publicObjectKey,
        mimeType: input.mimeType,
        byteSize: BigInt(input.bytes.byteLength),
        sha256,
        processingStatus,
        scanStatus,
        metadata: {
          ...input.metadata,
          ...(promote === 'magic_bytes_best_effort'
            ? {
                scanNote: 'magic_bytes_promoted_worker_offline',
                clamav: 'skipped',
                promotedAt: new Date().toISOString(),
              }
            : { scanNote: 'magic_bytes_only_awaiting_worker' }),
        },
      })
      .returning();
    const asset = rows[0]!;
    await transaction.insert(unitMedia).values({
      organizationId: claims.organizationId!,
      unitId: input.unitId,
      mediaAssetId: asset.id,
      position: input.position,
    });
    await transaction.insert(outboxEvents).values({
      organizationId: claims.organizationId!,
      topic: 'media.uploaded',
      aggregateType: 'media_asset',
      aggregateId: asset.id,
      payload: {
        privateObjectKey: input.objectKey,
        expectedSha256: sha256,
        via: 'vercel-neon-direct',
        promoteMode: promote,
      },
    });
    return asset.id;
  });
}

export async function uploadUnitMediaOnNeon(
  claims: SessionClaims,
  input: {
    unitId: string;
    purpose: 'property_image' | 'attachment';
    position: number;
    mimeType: string;
    bytes: Buffer;
    fileName?: string;
  },
): Promise<{ assetId: string; url: string }> {
  if (!claims.organizationId) throw new Error('organization_required');
  if (!claims.permissions.includes('media.create')) throw new Error('forbidden');

  if (input.bytes.byteLength < 1 || input.bytes.byteLength > 12 * 1024 * 1024) {
    throw new Error('invalid_file');
  }

  const detected = detectAllowedMime(input.bytes, input.purpose);
  if (!detected) throw new Error('invalid_file');

  const mimeType = detected;
  const extension = extensionFor(mimeType);
  const objectKey = `org/${claims.organizationId}/units/${input.unitId}/${randomUUID()}.${extension}`;

  // Always private bucket — public pages stream via BFF (P0-03).
  if (s3BucketsReady()) {
    try {
      const privateBucket = process.env.S3_BUCKET_PRIVATE!.trim();
      await getS3().send(
        new PutObjectCommand({
          Bucket: privateBucket,
          Key: objectKey,
          Body: input.bytes,
          ContentType: mimeType,
          ContentLength: input.bytes.byteLength,
        }),
      );
      const assetId = await persistAssetRow(claims, {
        ...input,
        mimeType,
        objectKey,
        publicObjectKey: null,
        metadata: {
          purpose: input.purpose,
          unitId: input.unitId,
          via: 'vercel-neon-s3-private',
          fileName: input.fileName ?? null,
          storage: 's3',
          clientMimeIgnored: input.mimeType,
        },
      });
      return { assetId, url: `/api/owner/media/${assetId}` };
    } catch (error) {
      console.error('S3 property media upload failed', error);
      if (isProductionRuntime()) throw new Error('storage_unavailable');
    }
  }

  // Inline Base64 is local/dev only — blocked in production (P0-03).
  if (isProductionRuntime()) throw new Error('storage_unavailable');
  if (input.bytes.byteLength > INLINE_MAX_BYTES) throw new Error('inline_too_large');

  const assetId = await persistAssetRow(claims, {
    ...input,
    mimeType,
    objectKey: `inline/${objectKey}`,
    publicObjectKey: null,
    metadata: {
      purpose: input.purpose,
      unitId: input.unitId,
      via: 'vercel-neon-inline-dev',
      fileName: input.fileName ?? null,
      storage: 'inline',
      dataBase64: input.bytes.toString('base64'),
      scanNote: 'magic_bytes_only_dev_inline',
    },
  });
  return { assetId, url: `/api/owner/media/${assetId}` };
}

export async function loadUnitMediaBytes(
  claims: SessionClaims,
  assetId: string,
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  if (!claims.organizationId) return null;

  const asset = await withinTenant(claims, async (transaction) => {
    return transaction.query.mediaAssets.findFirst({
      where: and(
        eq(mediaAssets.id, assetId),
        eq(mediaAssets.organizationId, claims.organizationId!),
      ),
    });
  });
  if (!asset) return null;

  const meta = (asset.metadata ?? {}) as InlineMeta;
  if (meta.storage === 'inline' && typeof meta.dataBase64 === 'string' && meta.dataBase64) {
    return { bytes: Buffer.from(meta.dataBase64, 'base64'), mimeType: asset.mimeType };
  }

  if (!s3BucketsReady() && !s3Configured()) return null;
  if (!s3Configured()) return null;

  const publicBucket = process.env.S3_BUCKET_PUBLIC?.trim();
  const privateBucket =
    process.env.S3_BUCKET_PRIVATE?.trim() || process.env.S3_BUCKET_PUBLIC?.trim() || 'bhd-r-private';
  const bucket = asset.publicObjectKey && publicBucket ? publicBucket : privateBucket;
  const key = asset.publicObjectKey || asset.privateObjectKey;
  if (!key || key.startsWith('inline/')) return null;

  const result = await getS3().send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
  const body = result.Body;
  if (!body) return null;
  const bytes = Buffer.from(await body.transformToByteArray());
  return { bytes, mimeType: asset.mimeType };
}

/**
 * Remove a gallery/attachment media asset from the owner's org (unit_media + asset row + S3).
 */
export async function deleteUnitMediaAsset(
  claims: SessionClaims,
  assetId: string,
): Promise<boolean> {
  if (!claims.organizationId) throw new Error('organization_required');
  const canDelete =
    claims.permissions.includes('media.delete') ||
    (claims.permissions.includes('media.create') &&
      claims.permissions.includes('property.update'));
  if (!canDelete) throw new Error('forbidden');
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) throw new Error('invalid_asset');

  const keys = await withinTenant(claims, async (transaction) => {
    const asset = await transaction.query.mediaAssets.findFirst({
      where: and(
        eq(mediaAssets.id, assetId),
        eq(mediaAssets.organizationId, claims.organizationId!),
      ),
    });
    if (!asset) return null;

    await transaction
      .delete(unitMedia)
      .where(
        and(
          eq(unitMedia.mediaAssetId, assetId),
          eq(unitMedia.organizationId, claims.organizationId!),
        ),
      );

    await transaction
      .update(propertyDocuments)
      .set({ mediaAssetId: null })
      .where(
        and(
          eq(propertyDocuments.mediaAssetId, assetId),
          eq(propertyDocuments.organizationId, claims.organizationId!),
        ),
      );

    const reserved = await transaction.execute(sql`
      select 1 as ok
      from reservation_documents
      where media_asset_id = ${assetId}::uuid
        and organization_id = ${claims.organizationId!}::uuid
      limit 1
    `);
    const reservedRows = Array.isArray(reserved)
      ? reserved
      : ((reserved as { rows?: unknown[] }).rows ?? []);
    if (reservedRows.length === 0) {
      await transaction
        .delete(mediaAssets)
        .where(
          and(
            eq(mediaAssets.id, assetId),
            eq(mediaAssets.organizationId, claims.organizationId!),
          ),
        );
    }

    return {
      privateObjectKey: asset.privateObjectKey,
      publicObjectKey: asset.publicObjectKey,
      dropObject: reservedRows.length === 0,
    };
  });

  if (!keys) return false;

  // Best-effort S3 delete outside the DB transaction (P2-03).
  if (keys.dropObject && s3Configured()) {
    const publicBucket = process.env.S3_BUCKET_PUBLIC?.trim();
    const privateBucket = process.env.S3_BUCKET_PRIVATE?.trim();
    const client = getS3();
    const targets: Array<{ Bucket: string; Key: string }> = [];
    if (keys.publicObjectKey && publicBucket && !keys.publicObjectKey.startsWith('inline/')) {
      targets.push({ Bucket: publicBucket, Key: keys.publicObjectKey });
    }
    if (keys.privateObjectKey && privateBucket && !keys.privateObjectKey.startsWith('inline/')) {
      targets.push({ Bucket: privateBucket, Key: keys.privateObjectKey });
    }
    for (const target of targets) {
      try {
        await client.send(new DeleteObjectCommand(target));
      } catch (error) {
        console.error('S3 media delete failed', target.Key, error);
      }
    }
  }

  return true;
}

export { s3Configured, s3BucketsReady };
