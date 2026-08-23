import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mediaAssets, outboxEvents, unitMedia, units } from '@bhd-r/db';
import type { SessionClaims } from '@bhd-r/authz';
import { DatabaseService } from '../database/database.service.js';

const allowedImages = new Set(['image/jpeg', 'image/png', 'image/webp']);
const allowedDocuments = new Set(['application/pdf']);

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
      purpose: 'property_image' | 'attachment';
      unitId?: string | undefined;
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
      const rows = await transaction
        .insert(mediaAssets)
        .values({
          organizationId: claims.organizationId!,
          uploadedByUserId: claims.sub,
          privateObjectKey: objectKey,
          mimeType: input.mimeType,
          byteSize: BigInt(input.byteSize),
          metadata: { purpose: input.purpose, unitId: input.unitId },
        })
        .returning();
      return rows[0]!;
    });
    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_PRIVATE ?? 'bhd-r-private',
      Key: objectKey,
      ContentType: input.mimeType,
      ContentLength: input.byteSize,
      Metadata: { assetid: asset.id, organizationid: claims.organizationId! },
    });
    const uploadUrl = await getSignedUrl(this.#s3, command, { expiresIn: 300 });
    return {
      assetId: asset.id,
      uploadUrl,
      expiresInSeconds: 300,
      requiredHeaders: { 'content-type': input.mimeType },
    };
  }

  complete(
    claims: SessionClaims,
    assetId: string,
    input: { sha256: string; unitId?: string | undefined },
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
}
