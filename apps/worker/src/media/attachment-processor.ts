import { createHash } from 'node:crypto';
import type { WorkerConfig } from '../config.js';
import { PermanentJobError } from '../errors.js';
import type { StorageAdapter } from '../storage.js';
import type { AttachmentJob } from '../types.js';
import { assertSafeImage } from './magic.js';
import type { MalwareScanner } from './scanner.js';

export interface AttachmentResult {
  privateObjectKey: string;
  sha256: string;
  bytes: number;
  contentType: AttachmentJob['expectedContentType'];
}

export function createAttachmentProcessor(
  config: WorkerConfig,
  storage: StorageAdapter,
  scanner: MalwareScanner,
): (job: AttachmentJob) => Promise<AttachmentResult> {
  return async (job) => {
    const sourceBucket = job.sourceBucket ?? config.S3_BUCKET_PRIVATE;
    if (sourceBucket !== config.S3_BUCKET_PRIVATE) {
      throw new PermanentJobError(
        'ATTACHMENT_SOURCE_BUCKET_REJECTED',
        'Only the private upload bucket is accepted',
      );
    }
    const bytes = await storage.get(sourceBucket, job.sourceKey);
    if (bytes.byteLength === 0 || bytes.byteLength > 25 * 1024 * 1024) {
      throw new PermanentJobError(
        'ATTACHMENT_SIZE_REJECTED',
        'Attachment is empty or exceeds the size limit',
      );
    }
    if (job.expectedSize !== undefined && job.expectedSize !== bytes.byteLength) {
      throw new PermanentJobError(
        'ATTACHMENT_SIZE_MISMATCH',
        'Attachment size does not match the upload intent',
      );
    }
    if (job.expectedContentType === 'application/pdf') {
      if (Buffer.from(bytes.subarray(0, 5)).toString('ascii') !== '%PDF-') {
        throw new PermanentJobError(
          'ATTACHMENT_TYPE_MISMATCH',
          'The file is not a valid PDF container',
        );
      }
    } else {
      assertSafeImage(bytes, job.expectedContentType, 25 * 1024 * 1024, job.expectedSize);
    }
    const scan = await scanner.scan(bytes);
    if (scan.status === 'infected') {
      const quarantineKey = `quarantine/${job.organizationId}/${job.mediaAssetId}/${Date.now()}`;
      await storage.putPrivate(quarantineKey, bytes, 'application/octet-stream', {
        reason: 'malware',
      });
      await storage.deletePrivate(job.sourceKey);
      throw new PermanentJobError(
        'ATTACHMENT_MALWARE_DETECTED',
        `Attachment quarantined: ${scan.signature}`,
      );
    }
    if (scan.status === 'unavailable' && config.MEDIA_SCAN_MODE === 'required') {
      throw new Error('Malware scanner is unavailable; attachment will be retried');
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (job.expectedSha256 && job.expectedSha256 !== sha256) {
      throw new PermanentJobError('ATTACHMENT_HASH_MISMATCH', 'Attachment checksum does not match');
    }
    const extension =
      job.expectedContentType === 'application/pdf'
        ? 'pdf'
        : job.expectedContentType === 'image/jpeg'
          ? 'jpg'
          : job.expectedContentType === 'image/png'
            ? 'png'
            : 'webp';
    const privateObjectKey = `attachments/${job.organizationId}/${sha256}.${extension}`;
    await storage.putPrivate(privateObjectKey, bytes, job.expectedContentType, {
      sha256,
      scan: scan.status,
    });
    if (job.sourceKey !== privateObjectKey) await storage.deletePrivate(job.sourceKey);
    return {
      privateObjectKey,
      sha256,
      bytes: bytes.byteLength,
      contentType: job.expectedContentType,
    };
  };
}
