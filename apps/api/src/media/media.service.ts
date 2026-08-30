import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mediaAssets, outboxEvents, propertyDocuments, unitMedia, units } from '@bhd-r/db';
import type { SessionClaims } from '@bhd-r/authz';
import { DatabaseService } from '../database/database.service.js';

const allowedImages = new Set(['image/jpeg', 'image/png', 'image/webp']);
const allowedDocuments = new Set(['application/pdf']);

type IngressClaims = {
  assetId: string;
  organizationId: string;
  objectKey: string;
  mimeType: string;
  byteSize: number;
  exp: number;
};

function ingressSecret(): string {
  return (
    process.env.MEDIA_INGRESS_SECRET ??
    process.env.CSRF_SECRET ??
    process.env.BHD_R_SESSION_SECRET ??
    'development-media-ingress-secret-must-be-long'
  );
}

function mediaUploadBaseUrl(): string {
  const configured =
    process.env.MEDIA_UPLOAD_BASE_URL?.trim() || process.env.PUBLIC_NEST_ORIGIN?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const render = process.env.RENDER_EXTERNAL_URL?.trim();
  if (render) return render.replace(/\/$/, '');
  return `http://127.0.0.1:${process.env.PORT ?? 4000}`;
}

function signIngress(claims: IngressClaims): string {
  const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const sig = createHmac('sha256', ingressSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyIngress(token: string): IngressClaims {
  const [body, sig] = token.split('.');
  if (!body || !sig) throw new UnauthorizedException('Invalid upload token');
  const expected = createHmac('sha256', ingressSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new UnauthorizedException('Invalid upload token');
  let claims: IngressClaims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as IngressClaims;
  } catch {
    throw new UnauthorizedException('Invalid upload token');
  }
  if (!claims.assetId || !claims.objectKey || !claims.mimeType || !claims.exp)
    throw new UnauthorizedException('Invalid upload token');
  if (claims.exp < Math.floor(Date.now() / 1000))
    throw new UnauthorizedException('Upload token expired');
  return claims;
}

@Injectable()
export class MediaService {
  readonly #s3 = new S3Client({
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    ...(process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY
      ? {
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY,
            secretAccessKey: process.env.S3_SECRET_KEY,
          },
        }
      : {}),
  });
  constructor(private readonly database: DatabaseService) {}

  async createUploadIntent(
    claims: SessionClaims,
    input: {
      purpose: 'property_image' | 'attachment' | 'reservation_document';
      unitId?: string | undefined;
      reservationId?: string | undefined;
      mimeType: string;
      byteSize: number;
    },
  ) {
    const allowed =
      input.purpose === 'property_image'
        ? allowedImages
        : new Set([...allowedImages, ...allowedDocuments]);
    const max = input.purpose === 'property_image' ? 15 * 1024 * 1024 : 25 * 1024 * 1024;
    if (!allowed.has(input.mimeType) || input.byteSize < 1 || input.byteSize > max)
      throw new ConflictException('File type or size is not allowed');
    if (input.purpose === 'property_image' && !input.unitId)
      throw new ConflictException('Property images require a unit');
    if (input.purpose === 'reservation_document' && !input.reservationId)
      throw new ConflictException('Reservation documents require a reservation');
    const extension =
      input.mimeType === 'image/jpeg'
        ? 'jpg'
        : input.mimeType === 'image/png'
          ? 'png'
          : input.mimeType === 'image/webp'
            ? 'webp'
            : 'pdf';
    const objectKey = `org/${claims.organizationId}/incoming/${randomUUID()}.${extension}`;
    const asset = await this.database.withinTenant(claims, async (transaction) => {
      if (input.unitId) {
        const unit = await transaction.query.units.findFirst({
          where: and(eq(units.id, input.unitId), eq(units.organizationId, claims.organizationId!)),
        });
        if (!unit) throw new NotFoundException('Unit not found');
      }
      if (input.reservationId) {
        const reservation = await transaction.query.reservations.findFirst({
          where: and(
            eq(reservations.id, input.reservationId),
            eq(reservations.organizationId, claims.organizationId!),
          ),
        });
        if (!reservation || !['pending', 'confirmed'].includes(reservation.status))
          throw new NotFoundException('Open reservation not found');
      }
      const rows = await transaction
        .insert(mediaAssets)
        .values({
          organizationId: claims.organizationId!,
          uploadedByUserId: claims.sub,
          privateObjectKey: objectKey,
          mimeType: input.mimeType,
          byteSize: BigInt(input.byteSize),
          metadata: {
            purpose: input.purpose,
            ...(input.unitId ? { unitId: input.unitId } : {}),
            ...(input.reservationId ? { reservationId: input.reservationId } : {}),
          },
        })
        .returning();
      return rows[0]!;
    });
    const expiresInSeconds = 300;
    const ingressToken = signIngress({
      assetId: asset.id,
      organizationId: claims.organizationId!,
      objectKey,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
    });
    // Prefer same-origin BFF `/api/backend/v1/...` (avoids Next rewrite body limits + CORS).
    // Absolute Nest URL remains as fallback.
    const uploadPath = `/api/backend/v1/media/ingress/${ingressToken}`;
    const uploadUrl = `${mediaUploadBaseUrl()}/v1/media/ingress/${ingressToken}`;
    return {
      assetId: asset.id,
      uploadUrl,
      uploadPath,
      expiresInSeconds,
      requiredHeaders: { 'content-type': input.mimeType },
    };
  }

  async acceptIngressUpload(token: string, body: Buffer, contentType: string | undefined) {
    const claims = verifyIngress(token);
    if (body.byteLength < 1 || body.byteLength > claims.byteSize + 1024)
      throw new ConflictException('Upload size mismatch');
    if (contentType && contentType.split(';')[0]!.trim() !== claims.mimeType)
      throw new ConflictException('Upload content type mismatch');
    const asset = await this.database.asSystem(async (transaction) => {
      return transaction.query.mediaAssets.findFirst({
        where: and(
          eq(mediaAssets.id, claims.assetId),
          eq(mediaAssets.organizationId, claims.organizationId),
          eq(mediaAssets.processingStatus, 'pending'),
        ),
      });
    });
    if (!asset || asset.privateObjectKey !== claims.objectKey)
      throw new NotFoundException('Upload intent not found');
    await this.#s3.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_PRIVATE ?? 'bhd-r-private',
        Key: claims.objectKey,
        Body: body,
        ContentType: claims.mimeType,
        ContentLength: body.byteLength,
        Metadata: { assetid: claims.assetId, organizationid: claims.organizationId },
      }),
    );
    return { assetId: claims.assetId, receivedBytes: body.byteLength };
  }

  complete(
    claims: SessionClaims,
    assetId: string,
    input: {
      sha256: string;
      unitId?: string | undefined;
      reservationId?: string | undefined;
      position?: number | undefined;
    },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .update(mediaAssets)
        .set({ sha256: input.sha256, processingStatus: 'queued', updatedAt: new Date() })
        .where(
          and(
            eq(mediaAssets.id, assetId),
            eq(mediaAssets.organizationId, claims.organizationId!),
            eq(mediaAssets.processingStatus, 'pending'),
          ),
        )
        .returning();
      const asset = rows[0];
      if (!asset) throw new NotFoundException('Upload intent not found or already completed');
      const metadata = asset.metadata as Record<string, unknown>;
      if (
        input.reservationId &&
        (metadata.purpose !== 'reservation_document' ||
          metadata.reservationId !== input.reservationId)
      )
        throw new ConflictException('Upload intent does not belong to this reservation');
      if (input.unitId) {
        const unit = await transaction.query.units.findFirst({
          where: and(eq(units.id, input.unitId), eq(units.organizationId, claims.organizationId!)),
        });
        if (!unit) throw new NotFoundException('Unit not found in this organization');
        await transaction
          .insert(unitMedia)
          .values({
            organizationId: claims.organizationId!,
            unitId: input.unitId,
            mediaAssetId: asset.id,
            position: input.position ?? 0,
          })
          .onConflictDoNothing();
      }
      await transaction.insert(outboxEvents).values({
        organizationId: claims.organizationId!,
        topic: 'media.uploaded',
        aggregateType: 'media_asset',
        aggregateId: asset.id,
        payload: { privateObjectKey: asset.privateObjectKey, expectedSha256: input.sha256 },
      });
      return { assetId: asset.id, status: 'queued' };
    });
  }

  async reservationDocumentUrl(claims: SessionClaims, assetId: string) {
    const asset = await this.database.withinTenant(claims, async (transaction) => {
      const row = await transaction.query.mediaAssets.findFirst({
        where: and(
          eq(mediaAssets.id, assetId),
          eq(mediaAssets.organizationId, claims.organizationId!),
        ),
      });
      const metadata = row?.metadata as Record<string, unknown> | undefined;
      if (
        !row ||
        metadata?.purpose !== 'reservation_document' ||
        row.processingStatus !== 'ready' ||
        row.scanStatus !== 'clean'
      )
        throw new NotFoundException('Clean reservation document not found');
      return row;
    });
    const extension =
      asset.mimeType === 'application/pdf'
        ? 'pdf'
        : asset.mimeType === 'image/png'
          ? 'png'
          : asset.mimeType === 'image/webp'
            ? 'webp'
            : 'jpg';
    const url = await getSignedUrl(
      this.#s3,
      new GetObjectCommand({
        Bucket: process.env.S3_BUCKET_PRIVATE ?? 'bhd-r-private',
        Key: asset.privateObjectKey,
        ResponseContentDisposition: `inline; filename="reservation-document-${asset.id}.${extension}"`,
        ResponseContentType: asset.mimeType,
      }),
      { expiresIn: 180 },
    );
    return { url, expiresInSeconds: 180 };
  }

  async deleteAsset(claims: SessionClaims, assetId: string): Promise<{ ok: true; assetId: string }> {
    const keys = await this.database.withinTenant(claims, async (transaction) => {
      const asset = await transaction.query.mediaAssets.findFirst({
        where: and(
          eq(mediaAssets.id, assetId),
          eq(mediaAssets.organizationId, claims.organizationId!),
        ),
      });
      if (!asset) throw new NotFoundException('Media asset not found');

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

    if (keys.dropObject) {
      const publicBucket = process.env.S3_BUCKET_PUBLIC?.trim();
      const privateBucket = process.env.S3_BUCKET_PRIVATE?.trim();
      const targets: Array<{ Bucket: string; Key: string }> = [];
      if (keys.publicObjectKey && publicBucket && !keys.publicObjectKey.startsWith('inline/')) {
        targets.push({ Bucket: publicBucket, Key: keys.publicObjectKey });
      }
      if (keys.privateObjectKey && privateBucket && !keys.privateObjectKey.startsWith('inline/')) {
        targets.push({ Bucket: privateBucket, Key: keys.privateObjectKey });
      }
      for (const target of targets) {
        try {
          await this.#s3.send(new DeleteObjectCommand(target));
        } catch {
          /* best-effort S3 cleanup */
        }
      }
    }

    return { ok: true, assetId };
  }
}
