import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { and, eq, sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import { createDatabase, mediaAssets, propertyDocuments, unitMedia, units, type Database } from '@bhd-r/db';

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
        processingStatus: 'ready',
        scanStatus: 'clean',
        metadata: input.metadata,
      })
      .returning();
    const asset = rows[0]!;
    await transaction.insert(unitMedia).values({
      organizationId: claims.organizationId!,
      unitId: input.unitId,
      mediaAssetId: asset.id,
      position: input.position,
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

  const allowed =
    input.purpose === 'property_image'
      ? new Set(['image/jpeg', 'image/png', 'image/webp'])
      : new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
  if (
    !allowed.has(input.mimeType) ||
    input.bytes.byteLength < 1 ||
    input.bytes.byteLength > 12 * 1024 * 1024
  ) {
    throw new Error('invalid_file');
  }

  const extension = extensionFor(input.mimeType);
  const objectKey = `org/${claims.organizationId}/units/${input.unitId}/${randomUUID()}.${extension}`;

  // Prefer R2/S3 when a real private bucket is configured.
  if (s3BucketsReady()) {
    try {
      const publicBucket = process.env.S3_BUCKET_PUBLIC?.trim();
      const privateBucket = process.env.S3_BUCKET_PRIVATE!.trim();
      const usePublic = Boolean(publicBucket) && input.purpose === 'property_image';
      const bucket = usePublic ? publicBucket! : privateBucket;
      await getS3().send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Body: input.bytes,
          ContentType: input.mimeType,
          ContentLength: input.bytes.byteLength,
        }),
      );
      const assetId = await persistAssetRow(claims, {
        ...input,
        objectKey,
        publicObjectKey: usePublic ? objectKey : null,
        metadata: {
          purpose: input.purpose,
          unitId: input.unitId,
          via: 'vercel-neon-s3',
          fileName: input.fileName ?? null,
          storage: 's3',
        },
      });
      return { assetId, url: `/api/owner/media/${assetId}` };
    } catch (error) {
      console.error('S3 property media upload failed; trying Neon inline', error);
      // Fall through to inline Neon when R2 bucket is missing/misnamed.
    }
  }

  if (input.bytes.byteLength > INLINE_MAX_BYTES) {
    throw new Error('inline_too_large');
  }

  const assetId = await persistAssetRow(claims, {
    ...input,
    objectKey: `inline/${objectKey}`,
    publicObjectKey: null,
    metadata: {
      purpose: input.purpose,
      unitId: input.unitId,
      via: 'vercel-neon-inline',
      fileName: input.fileName ?? null,
      storage: 'inline',
      dataBase64: input.bytes.toString('base64'),
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
 * Remove a gallery/attachment media asset from the owner's org (unit_media + asset row).
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

  return withinTenant(claims, async (transaction) => {
    const asset = await transaction.query.mediaAssets.findFirst({
      where: and(
        eq(mediaAssets.id, assetId),
        eq(mediaAssets.organizationId, claims.organizationId!),
      ),
    });
    if (!asset) return false;

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

    return true;
  });
}

export { s3Configured, s3BucketsReady };
