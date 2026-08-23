import { createHash } from 'node:crypto';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import type { WorkerConfig } from '../config.js';
import { PermanentJobError } from '../errors.js';
import { logger } from '../logger.js';
import { sanitizeDocumentFragment, wrapPrintableHtml } from '../pdf/sanitize.js';
import type { NotificationJob } from '../types.js';

const emailSchema = z.string().email().max(320);

export function createNotificationProcessor(
  config: WorkerConfig,
): (job: NotificationJob) => Promise<{ messageId: string }> {
  const auth =
    config.SMTP_USER && config.SMTP_PASSWORD
      ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
      : undefined;
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE === 'true',
    ...(auth ? { auth } : {}),
    connectionTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return async (job) => {
    const parsed = emailSchema.safeParse(job.recipient);
    if (!parsed.success)
      throw new PermanentJobError('NOTIFICATION_RECIPIENT_INVALID', 'Recipient is invalid');
    const safeHtml = job.html
      ? wrapPrintableHtml(sanitizeDocumentFragment(job.html), 'ar')
      : undefined;
    const result = await transport.sendMail({
      from: config.EMAIL_FROM,
      to: parsed.data,
      subject: job.subject.slice(0, 180),
      text: job.text,
      ...(safeHtml ? { html: safeHtml } : {}),
      headers: {
        'X-BHD-R-Notification-Id': job.notificationId,
        'X-Correlation-Id': job.correlationId,
      },
    });
    logger.info(
      {
        notificationId: job.notificationId,
        recipientHash: createHash('sha256')
          .update(parsed.data.toLowerCase())
          .digest('hex')
          .slice(0, 16),
        messageId: result.messageId,
      },
      'Notification delivered',
    );
    return { messageId: result.messageId };
  };
}
