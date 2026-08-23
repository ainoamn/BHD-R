import { z } from 'zod';

const context = {
  correlationId: z.string().uuid(),
  organizationId: z.string().uuid(),
  actorId: z.string().uuid().optional(),
};

export const mediaJobSchema = z.object({
  ...context,
  mediaAssetId: z.string().uuid().optional(),
  sourceKey: z.string().min(1).max(1024),
  sourceBucket: z.string().min(3).max(63).optional(),
  propertyId: z.string().uuid(),
  expectedContentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  expectedSize: z.number().int().positive().optional(),
  expectedSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  watermarkText: z.string().min(1).max(48).optional(),
});

export const attachmentJobSchema = z.object({
  ...context,
  mediaAssetId: z.string().uuid(),
  sourceKey: z.string().min(1).max(1024),
  sourceBucket: z.string().min(3).max(63).optional(),
  expectedContentType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  expectedSize: z.number().int().positive().optional(),
  expectedSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});

export const pdfJobSchema = z.object({
  ...context,
  documentId: z.string().uuid(),
  documentType: z.enum(['contract', 'invoice', 'receipt', 'report']),
  html: z.string().min(1).max(2_000_000),
  outputKey: z.string().min(1).max(1024),
  locale: z.enum(['ar', 'en']),
});

export const notificationJobSchema = z.object({
  ...context,
  notificationId: z.string().uuid(),
  channel: z.literal('email'),
  recipient: z.string().min(3).max(320),
  subject: z.string().min(1).max(180),
  text: z.string().min(1).max(100_000),
  html: z.string().max(500_000).optional(),
});

export const credentialNotificationJobSchema = z.object({
  ...context,
  notificationId: z.string().uuid(),
  outboxEventId: z.string().uuid(),
  credentialTokenId: z.string().uuid(),
  kind: z.enum(['activation', 'password_reset']),
});

export const domainEventJobSchema = z.object({
  eventId: z.string().uuid(),
  organizationId: z.string().uuid(),
  aggregateType: z.string().min(1).max(100),
  aggregateId: z.string().uuid(),
  topic: z.string().min(1).max(160),
  payload: z.unknown(),
});
