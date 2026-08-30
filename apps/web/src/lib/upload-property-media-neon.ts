import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { and, eq, sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import { createDatabase, mediaAssets, unitMedia, units, type Database } from '@bhd-r/db';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRPropertyWriteDb?: DbHandle };

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
    process.env.S3_ENDPOINT &&
      process.env.S3_ACCESS_KEY &&
      process.env.S3_SECRET_KEY &&
      !String(process.env.S3_ENDPOINT).includes('example.com'),
  );
}

function getS3(): S3Client {
  const endpoint = process.env.S3_ENDPOINT;
  if (!endpoint) throw new Error('s3_unconfigured');
  return new S3Client({
    region: process.env.S3_REGION ?? 'auto',
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
  if (!s3Configured()) throw new Error('s3_unconfigured');

  const allowed =
    input.purpose === 'property_image'
      ? new Set(['image/jpeg', 'image/png', 'image/webp'])
      : new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
  if (!allowed.has(input.mimeType) || input.bytes.byteLength < 1 || input.bytes.byteLength > 12 * 1024 * 1024) {
    throw new Error('invalid_file');
  }

  const extension =
    input.mimeType === 'image/png'
      ? 'png'
      : input.mimeType === 'image/webp'
        ? 'webp'
        : input.mimeType === 'application/pdf'
          ? 'pdf'
          : 'jpg';
  const objectKey = `org/${claims.organizationId}/units/${input.unitId}/${randomUUID()}.${extension}`;
  const publicBucket = process.env.S3_BUCKET_PUBLIC?.trim();
  const privateBucket = process.env.S3_BUCKET_PRIVATE?.trim() || 'bhd-r-private';
  const usePublic = Boolean(publicBucket) && input.purpose === 'property_image';
  const bucket = usePublic ? publicBucket! : privateBucket;
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');

  await getS3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: input.bytes,
      ContentType: input.mimeType,
      ContentLength: input.bytes.byteLength,
    }),
  );

  const assetId = await withinTenant(claims, async (transaction) => {
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
        privateObjectKey: objectKey,
        publicObjectKey: usePublic ? objectKey : null,
        mimeType: input.mimeType,
        byteSize: BigInt(input.bytes.byteLength),
        sha256,
        processingStatus: 'ready',
        scanStatus: 'clean',
        metadata: {
          purpose: input.purpose,
          unitId: input.unitId,
          via: 'vercel-neon',
          fileName: input.fileName ?? null,
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
    return asset.id;
  });

  return { assetId, url: `/api/owner/media/${assetId}` };
}

export async function loadUnitMediaBytes(
  claims: SessionClaims,
  assetId: string,
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  if (!claims.organizationId) return null;
  if (!s3Configured()) return null;

  const asset = await withinTenant(claims, async (transaction) => {
    return transaction.query.mediaAssets.findFirst({
      where: and(
        eq(mediaAssets.id, assetId),
        eq(mediaAssets.organizationId, claims.organizationId!),
      ),
    });
  });
  if (!asset) return null;

  const publicBucket = process.env.S3_BUCKET_PUBLIC?.trim();
  const privateBucket = process.env.S3_BUCKET_PRIVATE?.trim() || 'bhd-r-private';
  const bucket = asset.publicObjectKey && publicBucket ? publicBucket : privateBucket;
  const key = asset.publicObjectKey || asset.privateObjectKey;

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

export { s3Configured };
