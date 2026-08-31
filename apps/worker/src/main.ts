import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { decryptField, type Keyring } from '@bhd-r/security';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { PermanentJobError } from './errors.js';
import { startHealthServer } from './health.js';
import { logger } from './logger.js';
import { createAttachmentProcessor } from './media/attachment-processor.js';
import { createMediaProcessor } from './media/processor.js';
import { ClamAvScanner, DisabledScanner } from './media/scanner.js';
import { createNotificationProcessor } from './notifications/processor.js';
import { OutboxDispatcher } from './outbox.js';
import { createPdfProcessor } from './pdf/processor.js';
import {
  createEncryptionBackfillProcessor,
  encryptionBackfillPayloadSchema,
} from './encryption/backfill.js';
import { createReportProcessor } from './reports/processor.js';
import { ObjectStorage } from './storage.js';
import {
  QUEUES,
  type AttachmentJob,
  type CredentialNotificationJob,
  type DeadLetterJob,
  type DomainEventJob,
  type MediaJob,
  type NotificationJob,
  type PdfJob,
} from './types.js';
import {
  attachmentJobSchema,
  credentialNotificationJobSchema,
  domainEventJobSchema,
  mediaJobSchema,
  notificationJobSchema,
  pdfJobSchema,
} from './validation.js';
import { ensureStayTurnoverTask } from './stays/housekeeping.js';
import {
  isStayOutboxTopic,
  parseStayPlatformEnabled,
  STAY_JOB_NAMES,
} from './stays/jobs.js';
import {
  rebuildStayInventoryDaysForUnit,
  releaseExpiredStayHolds,
} from './stays/inventory-projector.js';

const config = loadConfig();
const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  connectionName: 'bhd-r-worker',
});
const pool = new Pool({
  connectionString: config.WORKER_DATABASE_URL ?? config.DATABASE_URL,
  max: 5,
  application_name: 'bhd-r-worker',
});
const storage = new ObjectStorage(config);
const scanner =
  config.MEDIA_SCAN_MODE === 'disabled'
    ? new DisabledScanner()
    : new ClamAvScanner(config.CLAMAV_HOST, config.CLAMAV_PORT);
const processMedia = createMediaProcessor(config, storage, scanner);
const processAttachment = createAttachmentProcessor(config, storage, scanner);
const processPdf = createPdfProcessor(config, storage);
const processNotification = createNotificationProcessor(config);
const processReport = createReportProcessor(pool, storage, processPdf);

const credentialPayloadSchema = z.object({
  tokenEncrypted: z.string().min(1).max(10_000),
  username: z.string().max(120).optional(),
});

interface CredentialNotificationRow {
  email: string;
  display_name: string;
  username: string;
  payload: unknown;
}

function encryptionKeyring(purpose: string): Keyring {
  const entries = Object.entries(process.env).filter(
    ([key, value]) => /^FIELD_ENCRYPTION_KEY_V\d+$/.test(key) && value,
  );
  const keys = Object.fromEntries(
    entries.map(([name, value]) => [
      name.replace('FIELD_ENCRYPTION_KEY_', '').toLowerCase(),
      createHash('sha256').update(`${value!}\0${purpose}`).digest(),
    ]),
  );
  return { activeVersion: config.FIELD_ENCRYPTION_ACTIVE_VERSION, keys };
}

const processEncryptionBackfill = createEncryptionBackfillProcessor(pool, encryptionKeyring);

function connection(): Redis {
  return redis.duplicate({ connectionName: 'bhd-r-bullmq' });
}

async function workerQuery<Row extends QueryResultRow>(
  text: string,
  values: readonly unknown[],
): Promise<QueryResult<Row>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL app.worker = 'true'");
    const result = await client.query<Row>(text, [...values]);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const deadLetterQueue = new Queue<DeadLetterJob>(QUEUES.deadLetter, { connection: connection() });
const mediaQueue = new Queue(QUEUES.media, { connection: connection() });
const pdfQueue = new Queue(QUEUES.pdf, { connection: connection() });
const notificationQueue = new Queue(QUEUES.notification, { connection: connection() });
const domainQueue = new Queue(QUEUES.domain, { connection: connection() });

async function runPermanentSafe<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    if (error instanceof PermanentJobError) {
      throw new UnrecoverableError(`${error.code}|${error.message}`);
    }
    throw error;
  }
}

const workers = [
  new Worker(
    QUEUES.media,
    (job: Job<MediaJob | AttachmentJob>) =>
      runPermanentSafe(async () => {
        try {
          if (job.name === 'process-attachment') {
            const input = attachmentJobSchema.parse(job.data);
            const result = await processAttachment(input);
            await workerQuery(
              `UPDATE media_assets
               SET private_object_key = $2, sha256 = $3, processing_status = 'ready', scan_status = 'clean', updated_at = now()
               WHERE id = $1 AND organization_id = $4`,
              [input.mediaAssetId, result.privateObjectKey, result.sha256, input.organizationId],
            );
            return result;
          }
          const input = mediaJobSchema.parse(job.data);
          const result = await processMedia(input);
          if (input.mediaAssetId) {
            const preferred =
              result.variants.find(
                (variant) => variant.format === 'webp' && variant.width >= 960,
              ) ?? result.variants.find((variant) => variant.format === 'webp');
            await workerQuery(
              `UPDATE media_assets
               SET private_object_key = $2,
                   public_object_key = $3,
                   sha256 = $4,
                   processing_status = 'ready',
                   scan_status = 'clean',
                   metadata = metadata || $5::jsonb,
                   updated_at = now()
               WHERE id = $1 AND organization_id = $6`,
              [
                input.mediaAssetId,
                result.originalKey,
                preferred?.key ?? null,
                result.sha256,
                JSON.stringify({
                  variants: result.variants,
                  width: result.width,
                  height: result.height,
                }),
                input.organizationId,
              ],
            );
          }
          return result;
        } catch (error) {
          if (error instanceof PermanentJobError && typeof job.data.mediaAssetId === 'string') {
            await workerQuery(
              `UPDATE media_assets
               SET processing_status = 'failed',
                   scan_status = CASE WHEN $3 LIKE '%MALWARE%' THEN 'infected' ELSE scan_status END,
                   updated_at = now()
               WHERE id = $1 AND organization_id = $2`,
              [job.data.mediaAssetId, job.data.organizationId, error.code],
            );
          }
          throw error;
        }
      }),
    { connection: connection(), concurrency: 3, limiter: { max: 20, duration: 1_000 } },
  ),
  new Worker(
    QUEUES.pdf,
    (job: Job<PdfJob>) =>
      runPermanentSafe(async () => {
        const input = pdfJobSchema.parse(job.data);
        const result = await processPdf(input);
        if (input.documentType === 'contract') {
          await workerQuery(
            `UPDATE contracts SET rendered_pdf_object_key = $2, rendered_pdf_hash = $3, updated_at = now()
             WHERE id = $1 AND organization_id = $4`,
            [input.documentId, result.key, result.sha256, input.organizationId],
          );
        }
        if (input.documentType === 'invoice') {
          await workerQuery(
            `UPDATE invoices SET rendered_pdf_object_key = $2, rendered_pdf_hash = $3, updated_at = now()
             WHERE id = $1 AND organization_id = $4`,
            [input.documentId, result.key, result.sha256, input.organizationId],
          );
        }
        if (input.documentType === 'receipt') {
          await workerQuery(
            `UPDATE receipts SET rendered_pdf_object_key = $2, rendered_pdf_hash = $3, updated_at = now()
             WHERE id = $1 AND organization_id = $4`,
            [input.documentId, result.key, result.sha256, input.organizationId],
          );
        }
        return result;
      }),
    { connection: connection(), concurrency: 2, limiter: { max: 6, duration: 1_000 } },
  ),
  new Worker(
    QUEUES.notification,
    (job: Job<NotificationJob | CredentialNotificationJob>) =>
      runPermanentSafe(async () => {
        if (job.name !== 'send-credential-email') {
          return processNotification(notificationJobSchema.parse(job.data));
        }
        const input = credentialNotificationJobSchema.parse(job.data);
        const result = await workerQuery<CredentialNotificationRow>(
          `SELECT u.email, u.display_name, u.username, oe.payload
           FROM outbox_events oe
           JOIN credential_tokens ct ON ct.id = oe.aggregate_id
           JOIN users u ON u.id = ct.user_id
           WHERE oe.id = $1 AND ct.id = $2`,
          [input.outboxEventId, input.credentialTokenId],
        );
        const row = result.rows[0];
        if (!row)
          throw new PermanentJobError(
            'NOTIFICATION_SOURCE_MISSING',
            'Credential notification source was not found',
          );
        const payload = credentialPayloadSchema.parse(row.payload);
        const token = decryptField(
          payload.tokenEncrypted,
          encryptionKeyring('notification-token'),
          `credential:${input.credentialTokenId}`,
        );
        const route = input.kind === 'activation' ? 'activate' : 'reset-password';
        const link = `${config.WEB_ORIGIN}/ar/${route}?token=${encodeURIComponent(token)}`;
        const subject =
          input.kind === 'activation'
            ? 'تفعيل حساب BHD R / Activate your BHD R account'
            : 'استعادة كلمة المرور / Reset password';
        const username =
          input.kind === 'activation'
            ? `\nUsername / اسم المستخدم: ${payload.username ?? row.username}`
            : '';
        return processNotification({
          notificationId: input.notificationId,
          channel: 'email',
          recipient: row.email,
          subject,
          text: `مرحباً ${row.display_name}\nHello ${row.display_name}${username}\n\n${link}\n\nهذا الرابط أحادي الاستخدام ومحدود الوقت.`,
          correlationId: input.correlationId,
          organizationId: input.organizationId,
        });
      }),
    { connection: connection(), concurrency: 5, limiter: { max: 15, duration: 1_000 } },
  ),
  new Worker(
    QUEUES.domain,
    (job: Job<DomainEventJob>) =>
      runPermanentSafe(async () => {
        const event = domainEventJobSchema.parse(job.data);
        if (event.topic === 'encryption.backfill') {
          const payload = encryptionBackfillPayloadSchema.parse(event.payload);
          const result = await processEncryptionBackfill(payload);
          if (result.failures.length > 0) {
            // Fail-closed: do not chain further batches past undecryptable rows (P1-06).
            throw new Error(
              `encryption_backfill_failures:${result.failures.length}:${result.failures
                .map((item) => item.rowId)
                .slice(0, 5)
                .join(',')}`,
            );
          }
          if (!result.done && payload.continue && result.nextAfterId) {
            await domainQueue.add(
              'domain-event',
              {
                ...event,
                eventId: randomUUID(),
                payload: {
                  ...payload,
                  afterId: result.nextAfterId,
                },
              },
              { jobId: `encryption-backfill:${payload.target}:${result.nextAfterId}` },
            );
          }
          return result;
        }

        if (isStayOutboxTopic(event.topic)) {
          if (!parseStayPlatformEnabled()) {
            return { skipped: true, reason: 'stays_platform_disabled' };
          }
          const payload =
            event.payload && typeof event.payload === 'object'
              ? (event.payload as Record<string, unknown>)
              : {};
          if (
            event.topic === 'stay.inventory.lock_created' ||
            event.topic === 'stay.inventory.changed' ||
            event.topic === 'stay_booking.payment_confirmed'
          ) {
            const organizationId = event.organizationId;
            if (!organizationId) return { skipped: true, reason: 'missing_organization' };

            let resolvedUnitId =
              typeof payload.unitId === 'string' ? payload.unitId : undefined;
            if (!resolvedUnitId && event.aggregateType === 'stay_inventory_lock') {
              const lock = await workerQuery<{ unit_id: string }>(
                `SELECT unit_id FROM stay_inventory_locks WHERE id = $1::uuid LIMIT 1`,
                [event.aggregateId],
              );
              resolvedUnitId = lock.rows[0]?.unit_id;
            }
            if (!resolvedUnitId && event.aggregateType === 'stay_booking') {
              const booking = await workerQuery<{ unit_id: string }>(
                `SELECT unit_id FROM stay_bookings WHERE id = $1::uuid LIMIT 1`,
                [event.aggregateId],
              );
              resolvedUnitId = booking.rows[0]?.unit_id;
            }
            if (!resolvedUnitId) return { skipped: true, reason: 'missing_unit' };

            return rebuildStayInventoryDaysForUnit(pool, {
              organizationId,
              unitId: resolvedUnitId,
            });
          }

          if (event.topic === 'stay.checked_out') {
            const organizationId = event.organizationId;
            if (!organizationId) return { skipped: true, reason: 'missing_organization' };
            const booking = await workerQuery<{ unit_id: string; check_out_on: string }>(
              `SELECT unit_id, check_out_on::text AS check_out_on
               FROM stay_bookings WHERE id = $1::uuid LIMIT 1`,
              [event.aggregateId],
            );
            const row = booking.rows[0];
            if (!row) return { skipped: true, reason: 'booking_missing' };
            const task = await ensureStayTurnoverTask(pool, {
              organizationId,
              bookingId: event.aggregateId,
              unitId: row.unit_id,
              dueOn: row.check_out_on,
            });
            await rebuildStayInventoryDaysForUnit(pool, {
              organizationId,
              unitId: row.unit_id,
            });
            return task;
          }
        }

        return processReport(event);
      }),
    { connection: connection(), concurrency: 2, limiter: { max: 5, duration: 1_000 } },
  ),
];

for (const worker of workers) {
  worker.on('completed', (job) => {
    logger.info(
      {
        queue: worker.name,
        jobId: job.id,
        correlationId: 'correlationId' in job.data ? job.data.correlationId : job.data.eventId,
      },
      'Job completed',
    );
  });
  worker.on('failed', (job, error) => {
    if (!job) return;
    const exhausted =
      error.name === 'UnrecoverableError' || job.attemptsMade >= (job.opts.attempts ?? 1);
    logger.warn(
      {
        queue: worker.name,
        jobId: job.id,
        correlationId: 'correlationId' in job.data ? job.data.correlationId : job.data.eventId,
        attemptsMade: job.attemptsMade,
        err: error,
      },
      'Job attempt failed',
    );
    if (!exhausted) return;
    const [errorCode = 'JOB_FAILED'] = error.message.split('|', 1);
    void deadLetterQueue.add(
      'failed-job',
      {
        queue: worker.name,
        jobId: String(job.id),
        ...('correlationId' in job.data && typeof job.data.correlationId === 'string'
          ? { correlationId: job.data.correlationId }
          : 'eventId' in job.data
            ? { correlationId: job.data.eventId }
            : {}),
        attemptsMade: job.attemptsMade,
        errorCode: errorCode.slice(0, 100),
        failedAt: new Date().toISOString(),
      },
      { jobId: `${worker.name}-${job.id}`, removeOnComplete: false, removeOnFail: false },
    );
  });
  worker.on('error', (error) => logger.error({ queue: worker.name, err: error }, 'Worker error'));
}

const outbox = new OutboxDispatcher(pool, {
  media: mediaQueue,
  pdf: pdfQueue,
  notification: notificationQueue,
  domain: domainQueue,
  deadLetter: deadLetterQueue,
});
outbox.start();
const healthServer = startHealthServer(config.WORKER_PORT, redis, pool);

const staysEnabled = parseStayPlatformEnabled();
let stayHoldExpirerTimer: NodeJS.Timeout | undefined;
if (staysEnabled) {
  const runHoldExpirer = () =>
    void releaseExpiredStayHolds(pool)
      .then((result) => {
        if (result.released > 0) {
          logger.info({ released: result.released, job: STAY_JOB_NAMES[0] }, 'Stay holds expired');
        }
      })
      .catch((error) => logger.error({ err: error }, 'Stay hold expirer failed'));
  runHoldExpirer();
  stayHoldExpirerTimer = setInterval(runHoldExpirer, 60_000);
  stayHoldExpirerTimer.unref();
  logger.info({ staysEnabled: true }, 'Stay hold expirer scheduled');
} else {
  logger.info({ staysEnabled: false }, 'Stay worker jobs idle (STAYS_PLATFORM_ENABLED off)');
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Graceful shutdown started');
  if (stayHoldExpirerTimer) clearInterval(stayHoldExpirerTimer);
  outbox.stop();
  healthServer.close();
  await Promise.all(workers.map((worker) => worker.close()));
  await Promise.all([
    mediaQueue.close(),
    pdfQueue.close(),
    notificationQueue.close(),
    domainQueue.close(),
    deadLetterQueue.close(),
  ]);
  await pool.end();
  redis.disconnect();
  logger.info('Graceful shutdown completed');
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (error) => logger.error({ err: error }, 'Unhandled rejection'));
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  void shutdown('uncaughtException').finally(() => process.exit(1));
});

logger.info({ environment: config.NODE_ENV }, 'BHD R worker started');
