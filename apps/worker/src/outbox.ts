import type { Queue } from 'bullmq';
import type { Pool, PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { logger } from './logger.js';
import type {
  AttachmentJob,
  CredentialNotificationJob,
  MediaJob,
  NotificationJob,
  OutboxRecord,
  PdfJob,
} from './types.js';
import {
  attachmentJobSchema,
  credentialNotificationJobSchema,
  mediaJobSchema,
  notificationJobSchema,
  pdfJobSchema,
} from './validation.js';

const BATCH_SIZE = 25;
const MAX_OUTBOX_ATTEMPTS = 12;

interface OutboxQueues {
  media: Queue;
  pdf: Queue;
  notification: Queue;
  domain: Queue;
  deadLetter: Queue;
}

interface MediaAssetRow {
  id: string;
  organization_id: string;
  private_object_key: string;
  mime_type: string;
  byte_size: string;
  sha256: string | null;
  purpose: string | null;
  property_id: string | null;
}

interface ContractRow {
  html: string;
  payload_snapshot: Record<string, unknown>;
}

interface ContractRecipientRow {
  party_id: string;
  display_name: string;
  email: string | null;
  party_role: 'owner' | 'tenant';
  reference: string | null;
  status: string;
}

interface InvoiceRow {
  invoice_number: string;
  currency: string;
  minor_unit: number;
  subtotal_minor: string;
  tax_minor: string;
  total_minor: string;
  issued_on: string;
  due_on: string;
}

interface ReceiptRow {
  receipt_number: string;
  amount_minor: string;
  currency: string;
  minor_unit: number;
  issued_at: string;
  invoice_number: string;
  provider: string;
  provider_reference: string;
}

export class OutboxDispatcher {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    readonly pool: Pool,
    private readonly queues: OutboxQueues,
    private readonly pollIntervalMs = 1_000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
    this.timer.unref();
    void this.poll();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async poll(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL app.worker = 'true'");
      const result = await client.query<OutboxRecord>(
        `SELECT id,
                organization_id,
                aggregate_type,
                aggregate_id,
                topic AS event_type,
                payload,
                CASE
                  WHEN payload->>'correlationId' ~* '^[0-9a-f-]{36}$' THEN payload->>'correlationId'
                  ELSE id::text
                END AS correlation_id,
                attempts
         FROM outbox_events
         WHERE published_at IS NULL
           AND attempts < $2
           AND occurred_at + make_interval(secs => LEAST(3600, power(2, attempts)::integer)) <= now()
         ORDER BY occurred_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1`,
        [BATCH_SIZE, MAX_OUTBOX_ATTEMPTS],
      );
      for (const record of result.rows) await this.dispatchRecord(client, record);
      await client.query('COMMIT');
      return result.rowCount ?? 0;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Outbox polling failed');
      return 0;
    } finally {
      client.release();
      this.running = false;
    }
  }

  private async dispatchRecord(client: PoolClient, record: OutboxRecord): Promise<void> {
    try {
      const options = {
        jobId: record.id,
        attempts: 5,
        backoff: { type: 'exponential' as const, delay: 1_000 },
        removeOnComplete: { age: 86_400, count: 5_000 },
        removeOnFail: { age: 2_592_000, count: 10_000 },
      };

      switch (record.event_type) {
        case 'media.uploaded': {
          const materialized = await this.materializeMedia(client, record);
          if (materialized.kind === 'image') {
            await this.queues.media.add(
              'process-image',
              mediaJobSchema.parse(materialized.job),
              options,
            );
          } else {
            await this.queues.media.add(
              'process-attachment',
              attachmentJobSchema.parse(materialized.job),
              options,
            );
          }
          break;
        }
        case 'media.processing.requested':
          await this.queues.media.add(
            'process-image',
            mediaJobSchema.parse(record.payload),
            options,
          );
          break;
        case 'contract.signature-requested': {
          await this.queues.pdf.add(
            'render-pdf',
            pdfJobSchema.parse(await this.materializeContract(client, record)),
            options,
          );
          const invitations = await this.materializeContractNotifications(
            client,
            record,
            'signature_requested',
          );
          await Promise.all(
            invitations.map((invitation) =>
              this.queues.notification.add(
                'send-email',
                notificationJobSchema.parse(invitation.job),
                { ...options, jobId: invitation.jobId },
              ),
            ),
          );
          break;
        }
        case 'contract.signed': {
          const notifications = await this.materializeContractNotifications(
            client,
            record,
            'signature_updated',
          );
          await Promise.all(
            notifications.map((notification) =>
              this.queues.notification.add(
                'send-email',
                notificationJobSchema.parse(notification.job),
                { ...options, jobId: notification.jobId },
              ),
            ),
          );
          break;
        }
        case 'invoice.issued':
          await this.queues.pdf.add(
            'render-pdf',
            pdfJobSchema.parse(await this.materializeInvoice(client, record)),
            options,
          );
          break;
        case 'receipt.issued':
          await this.queues.pdf.add(
            'render-pdf',
            pdfJobSchema.parse(await this.materializeReceipt(client, record)),
            options,
          );
          break;
        case 'document.render.requested':
          await this.queues.pdf.add('render-pdf', pdfJobSchema.parse(record.payload), options);
          break;
        case 'notification.requested':
        case 'tenant.activation-requested':
          await this.queues.notification.add(
            'send-credential-email',
            credentialNotificationJobSchema.parse(this.credentialNotificationReference(record)),
            options,
          );
          break;
        case 'notification.delivery.requested':
          await this.queues.notification.add(
            'send-email',
            notificationJobSchema.parse(record.payload),
            options,
          );
          break;
        default:
          await this.queues.domain.add(
            record.event_type,
            {
              eventId: record.id,
              organizationId: record.organization_id,
              aggregateType: record.aggregate_type,
              aggregateId: record.aggregate_id,
              topic: record.event_type,
              payload: record.payload,
            },
            options,
          );
      }

      await client.query('UPDATE outbox_events SET published_at = now() WHERE id = $1', [
        record.id,
      ]);
    } catch (error) {
      const attempts = record.attempts + 1;
      await client.query('UPDATE outbox_events SET attempts = $2 WHERE id = $1', [
        record.id,
        attempts,
      ]);
      logger.warn(
        { outboxId: record.id, eventType: record.event_type, attempts },
        'Outbox event deferred',
      );
      if (attempts >= MAX_OUTBOX_ATTEMPTS) {
        await this.queues.deadLetter.add(
          'outbox-dispatch-failed',
          {
            queue: 'outbox',
            jobId: record.id,
            correlationId: record.correlation_id,
            attemptsMade: attempts,
            errorCode:
              error instanceof z.ZodError ? 'OUTBOX_PAYLOAD_INVALID' : 'OUTBOX_DISPATCH_FAILED',
            failedAt: new Date().toISOString(),
          },
          { jobId: `outbox-${record.id}`, removeOnComplete: false, removeOnFail: false },
        );
      }
    }
  }

  private async materializeMedia(
    client: PoolClient,
    record: OutboxRecord,
  ): Promise<{ kind: 'image'; job: MediaJob } | { kind: 'attachment'; job: AttachmentJob }> {
    const result = await client.query<MediaAssetRow>(
      `SELECT ma.id,
              ma.organization_id,
              ma.private_object_key,
              ma.mime_type,
              ma.byte_size::text,
              ma.sha256,
              ma.metadata->>'purpose' AS purpose,
              u.property_id
       FROM media_assets ma
       LEFT JOIN unit_media um ON um.media_asset_id = ma.id AND um.organization_id = ma.organization_id
       LEFT JOIN units u ON u.id = COALESCE(um.unit_id, NULLIF(ma.metadata->>'unitId', '')::uuid)
                        AND u.organization_id = ma.organization_id
       WHERE ma.id = $1 AND ma.organization_id = $2
       LIMIT 1`,
      [record.aggregate_id, record.organization_id],
    );
    const asset = result.rows[0];
    if (!asset) throw new Error('Media asset for outbox event was not found');
    const base = {
      mediaAssetId: asset.id,
      correlationId: record.correlation_id,
      organizationId: asset.organization_id,
      sourceKey: asset.private_object_key,
      expectedSize: Number(asset.byte_size),
      ...(asset.sha256 ? { expectedSha256: asset.sha256 } : {}),
    };
    if (asset.purpose === 'property_image') {
      if (!asset.property_id) throw new Error('Property image is not attached to a property unit');
      return {
        kind: 'image',
        job: {
          ...base,
          propertyId: asset.property_id,
          expectedContentType: z
            .enum(['image/jpeg', 'image/png', 'image/webp'])
            .parse(asset.mime_type),
        },
      };
    }
    return {
      kind: 'attachment',
      job: {
        ...base,
        expectedContentType: z
          .enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
          .parse(asset.mime_type),
      },
    };
  }

  private credentialNotificationReference(record: OutboxRecord): CredentialNotificationJob {
    return {
      notificationId: record.id,
      outboxEventId: record.id,
      credentialTokenId: record.aggregate_id,
      kind: record.event_type === 'tenant.activation-requested' ? 'activation' : 'password_reset',
      correlationId: record.correlation_id,
      organizationId: record.organization_id ?? '00000000-0000-0000-0000-000000000000',
    };
  }

  private async materializeContract(client: PoolClient, record: OutboxRecord): Promise<PdfJob> {
    const result = await client.query<ContractRow>(
      `SELECT ct.html, c.payload_snapshot
       FROM contracts c
       JOIN contract_templates ct ON ct.id = c.template_version_id
       WHERE c.id = $1 AND c.organization_id = $2`,
      [record.aggregate_id, record.organization_id],
    );
    const contract = result.rows[0];
    if (!contract || !record.organization_id)
      throw new Error('Contract render source was not found');
    return {
      documentId: record.aggregate_id,
      documentType: 'contract',
      html: renderPlaceholders(contract.html, contract.payload_snapshot),
      outputKey: `contracts/${record.organization_id}/${record.aggregate_id}.pdf`,
      locale: 'ar',
      correlationId: record.correlation_id,
      organizationId: record.organization_id,
    };
  }

  private async materializeContractNotifications(
    client: PoolClient,
    record: OutboxRecord,
    kind: 'signature_requested' | 'signature_updated',
  ): Promise<Array<{ jobId: string; job: NotificationJob }>> {
    if (!record.organization_id) throw new Error('Contract organization was not found');
    const result = await client.query<ContractRecipientRow>(
      `SELECT p.id AS party_id,
              p.display_name,
              p.email,
              participant.party_role,
              c.reference,
              c.status
       FROM contracts c
       CROSS JOIN LATERAL (
         VALUES (c.owner_party_id, 'owner'::text), (c.tenant_party_id, 'tenant'::text)
       ) AS participant(party_id, party_role)
       JOIN parties p ON p.id = participant.party_id AND p.organization_id = c.organization_id
       WHERE c.id = $1 AND c.organization_id = $2`,
      [record.aggregate_id, record.organization_id],
    );
    const completed = result.rows[0]?.status === 'signed';
    return result.rows
      .filter(
        (recipient) =>
          recipient.email && (kind === 'signature_updated' || recipient.party_role === 'tenant'),
      )
      .map((recipient) => {
        const reference = recipient.reference ?? record.aggregate_id.slice(0, 8);
        const portal = recipient.party_role === 'tenant' ? 'tenant' : 'owner';
        const link = `${process.env.WEB_ORIGIN ?? 'http://localhost:3000'}/ar/${portal}/contracts/${record.aggregate_id}`;
        const isRequest = kind === 'signature_requested';
        const subject = isRequest
          ? `عقد بانتظار توقيعك ${reference} / Contract awaiting your signature`
          : completed
            ? `اكتمل توقيع العقد ${reference} / Contract signed`
            : `تم تحديث توقيعات العقد ${reference} / Contract signature updated`;
        const actionAr = isRequest
          ? 'يرجى مراجعة العقد وتوقيعه إلكترونياً من بوابتك الآمنة.'
          : completed
            ? 'اكتمل توقيع العقد من جميع الأطراف وأصبح المستند النهائي متاحاً في بوابتك.'
            : 'وقّع أحد الأطراف العقد. يمكنك مراجعة حالة التوقيع الحالية في بوابتك.';
        const actionEn = isRequest
          ? 'Please review and electronically sign the contract in your secure portal.'
          : completed
            ? 'All parties have signed the contract. The final document is available in your portal.'
            : 'A party has signed the contract. You can review its current signature status in your portal.';
        return {
          jobId: `${record.id}-${recipient.party_role}`,
          job: {
            notificationId: deterministicUuid(`${record.id}:${recipient.party_id}:${kind}`),
            channel: 'email' as const,
            recipient: recipient.email!,
            subject,
            text: `مرحباً ${recipient.display_name}\n${actionAr}\n\nHello ${recipient.display_name}\n${actionEn}\n\n${link}`,
            correlationId: record.correlation_id,
            organizationId: record.organization_id!,
          },
        };
      });
  }

  private async materializeInvoice(client: PoolClient, record: OutboxRecord): Promise<PdfJob> {
    const result = await client.query<InvoiceRow>(
      `SELECT invoice_number, currency, minor_unit, subtotal_minor::text, tax_minor::text,
              total_minor::text, issued_on::text, due_on::text
       FROM invoices WHERE id = $1 AND organization_id = $2`,
      [record.aggregate_id, record.organization_id],
    );
    const invoice = result.rows[0];
    if (!invoice || !record.organization_id) throw new Error('Invoice render source was not found');
    const money = (minor: string) =>
      `${formatMinorUnits(minor, invoice.minor_unit)} ${escapeHtml(invoice.currency)}`;
    const html = `<article dir="rtl"><h1>فاتورة / Invoice</h1><p><strong>${escapeHtml(invoice.invoice_number)}</strong></p><table><tbody><tr><th>تاريخ الإصدار</th><td>${escapeHtml(invoice.issued_on)}</td></tr><tr><th>تاريخ الاستحقاق</th><td>${escapeHtml(invoice.due_on)}</td></tr><tr><th>المجموع الفرعي</th><td>${money(invoice.subtotal_minor)}</td></tr><tr><th>الضريبة</th><td>${money(invoice.tax_minor)}</td></tr><tr><th>الإجمالي</th><td><strong>${money(invoice.total_minor)}</strong></td></tr></tbody></table></article>`;
    return {
      documentId: record.aggregate_id,
      documentType: 'invoice',
      html,
      outputKey: `invoices/${record.organization_id}/${record.aggregate_id}.pdf`,
      locale: 'ar',
      correlationId: record.correlation_id,
      organizationId: record.organization_id,
    };
  }

  private async materializeReceipt(client: PoolClient, record: OutboxRecord): Promise<PdfJob> {
    const result = await client.query<ReceiptRow>(
      `SELECT r.receipt_number,
              r.amount_minor::text,
              r.currency,
              p.minor_unit,
              r.issued_at::text,
              i.invoice_number,
              p.provider,
              p.provider_reference
       FROM receipts r
       JOIN payments p ON p.id = r.payment_id AND p.organization_id = r.organization_id
       JOIN invoices i ON i.id = p.invoice_id AND i.organization_id = r.organization_id
       WHERE r.id = $1 AND r.organization_id = $2`,
      [record.aggregate_id, record.organization_id],
    );
    const receipt = result.rows[0];
    if (!receipt || !record.organization_id) throw new Error('Receipt render source was not found');
    const amount = `${formatMinorUnits(receipt.amount_minor, receipt.minor_unit)} ${escapeHtml(receipt.currency)}`;
    const html = `<article dir="rtl"><h1>إيصال استلام / Payment receipt</h1><table><tbody><tr><th>رقم الإيصال / Receipt</th><td><strong>${escapeHtml(receipt.receipt_number)}</strong></td></tr><tr><th>الفاتورة / Invoice</th><td>${escapeHtml(receipt.invoice_number)}</td></tr><tr><th>المبلغ / Amount</th><td>${amount}</td></tr><tr><th>طريقة التحصيل / Provider</th><td>${escapeHtml(receipt.provider)}</td></tr><tr><th>مرجع الدفع / Payment reference</th><td>${escapeHtml(receipt.provider_reference)}</td></tr><tr><th>تاريخ الاستلام / Received</th><td>${escapeHtml(receipt.issued_at)}</td></tr></tbody></table></article>`;
    return {
      documentId: record.aggregate_id,
      documentType: 'receipt',
      html,
      outputKey: `receipts/${record.organization_id}/${record.aggregate_id}.pdf`,
      locale: 'ar',
      correlationId: record.correlation_id,
      organizationId: record.organization_id,
    };
  }
}

function escapeHtml(value: unknown): string {
  const scalar =
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
      ? String(value)
      : '';
  return scalar.replace(/[<>&"']/g, (character) => {
    const replacements: Record<string, string> = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return replacements[character] ?? '';
  });
}

export function formatMinorUnits(value: string, minorUnit: number): string {
  const integer = BigInt(value);
  const negative = integer < 0n;
  const digits = (negative ? -integer : integer).toString().padStart(minorUnit + 1, '0');
  if (minorUnit === 0) return `${negative ? '-' : ''}${digits}`;
  const major = digits.slice(0, -minorUnit);
  const fraction = digits.slice(-minorUnit);
  return `${negative ? '-' : ''}${major}.${fraction}`;
}

function renderPlaceholders(template: string, snapshot: Record<string, unknown>): string {
  return template.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, path: string) => {
    const value = path.split('.').reduce<unknown>((current, key) => {
      if (typeof current !== 'object' || current === null || Array.isArray(current))
        return undefined;
      return (current as Record<string, unknown>)[key];
    }, snapshot);
    return escapeHtml(value);
  });
}

function deterministicUuid(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join('');
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}
