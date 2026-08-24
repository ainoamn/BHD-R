export const QUEUES = {
  media: 'bhd-r.media',
  pdf: 'bhd-r.pdf',
  notification: 'bhd-r.notification',
  domain: 'bhd-r.domain',
  deadLetter: 'bhd-r.dead-letter',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface JobContext {
  correlationId: string;
  organizationId: string;
  actorId?: string | undefined;
}

export interface MediaJob extends JobContext {
  mediaAssetId?: string | undefined;
  sourceKey: string;
  sourceBucket?: string | undefined;
  propertyId: string;
  expectedContentType: 'image/jpeg' | 'image/png' | 'image/webp';
  expectedSize?: number | undefined;
  expectedSha256?: string | undefined;
  watermarkText?: string | undefined;
}

export interface AttachmentJob extends JobContext {
  mediaAssetId: string;
  sourceKey: string;
  sourceBucket?: string | undefined;
  expectedContentType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';
  expectedSize?: number | undefined;
  expectedSha256?: string | undefined;
}

export interface PdfJob extends JobContext {
  documentId: string;
  documentType: 'contract' | 'invoice' | 'receipt' | 'report';
  html: string;
  outputKey: string;
  locale: 'ar' | 'en';
}

export interface NotificationJob extends JobContext {
  notificationId: string;
  channel: 'email';
  recipient: string;
  subject: string;
  text: string;
  html?: string | undefined;
}

export interface CredentialNotificationJob extends JobContext {
  notificationId: string;
  outboxEventId: string;
  credentialTokenId: string;
  kind: 'activation' | 'password_reset';
}

export interface DomainEventJob {
  eventId: string;
  organizationId: string | null;
  aggregateType: string;
  aggregateId: string;
  topic: string;
  payload: unknown;
}

export interface DeadLetterJob {
  queue: string;
  jobId: string;
  correlationId?: string | undefined;
  attemptsMade: number;
  errorCode: string;
  failedAt: string;
}

export interface OutboxRecord {
  id: string;
  organization_id: string | null;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: unknown;
  correlation_id: string;
  attempts: number;
}
