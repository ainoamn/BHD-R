import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import type { Pool } from 'pg';
import { assertSafeOutboundUrl, decryptField, type Keyring } from '@bhd-r/security';
import { logger } from './logger.js';

export const HISABY_PUSH_TOPICS = new Set([
  'invoice.issued',
  'payment.recorded',
  'receipt.issued',
  'payment.refunded',
  'stay_booking.payment_confirmed',
  'reservation.deposit_confirmed',
  'accounting.journal-posted',
  'cheque.created',
]);

function encryptionKeyring(purpose: string): Keyring {
  const entries = Object.entries(process.env).filter(
    ([key, value]) => /^FIELD_ENCRYPTION_KEY_V\d+$/.test(key) && value,
  );
  if (entries.length === 0)
    entries.push(['FIELD_ENCRYPTION_KEY_V1', 'development-field-key-change-in-production']);
  const keys = Object.fromEntries(
    entries.map(([name, value]) => [
      name.replace('FIELD_ENCRYPTION_KEY_', '').toLowerCase(),
      createHash('sha256').update(`${value!}\0${purpose}`).digest(),
    ]),
  );
  return {
    activeVersion: process.env.FIELD_ENCRYPTION_ACTIVE_VERSION ?? 'v1',
    keys,
  };
}

interface HisabyLinkRow {
  events_url: string;
  inbound_token_encrypted: string;
  hisaby_company_id: string | null;
}

function mapTopic(topic: string): string {
  switch (topic) {
    case 'stay_booking.payment_confirmed':
      return 'stay.payment.succeeded';
    case 'payment.recorded':
      return 'lease.payment.received';
    case 'invoice.issued':
      return 'lease.invoice.issued';
    case 'accounting.journal-posted':
      return 'accounting.journal.posted';
    default:
      return topic;
  }
}

export async function pushHisabyDomainEvent(
  pool: Pool,
  input: {
    eventId: string;
    organizationId: string | null | undefined;
    topic: string;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
  },
): Promise<{ pushed: boolean; skipped?: string; status?: number }> {
  if (!input.organizationId) return { pushed: false, skipped: 'missing_organization' };
  if (!HISABY_PUSH_TOPICS.has(input.topic)) return { pushed: false, skipped: 'topic_not_synced' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL app.worker = 'true'");
    const result = await client.query<HisabyLinkRow>(
      `SELECT events_url, inbound_token_encrypted, hisaby_company_id
       FROM hisaby_links
       WHERE organization_id = $1::uuid
         AND status = 'active'
       LIMIT 1`,
      [input.organizationId],
    );
    const link = result.rows[0];
    if (!link) {
      await client.query('COMMIT');
      return { pushed: false, skipped: 'link_missing' };
    }

    let token: string;
    try {
      token = decryptField(
        link.inbound_token_encrypted,
        encryptionKeyring('hisaby-inbound'),
        `hisaby:${input.organizationId}`,
      );
    } catch (error) {
      await client.query(
        `UPDATE hisaby_links
         SET last_sync_at = now(),
             last_sync_status = 'failed',
             last_sync_error = $2,
             updated_at = now()
         WHERE organization_id = $1::uuid`,
        [input.organizationId, 'token_decrypt_failed'],
      );
      await client.query('COMMIT');
      logger.warn({ err: error, organizationId: input.organizationId }, 'Hisaby token decrypt failed');
      return { pushed: false, skipped: 'token_decrypt_failed' };
    }

    await assertSafeOutboundUrl(
      link.events_url,
      async (hostname) =>
        (await lookup(hostname, { all: true, verbatim: true })).map((record) => record.address),
      ['hisaby.bhd-om.com'],
    );

    const body = {
      idempotencyKey: input.eventId,
      type: mapTopic(input.topic),
      occurredOn: new Date().toISOString(),
      organizationExternalId: input.organizationId,
      hisabyCompanyId: link.hisaby_company_id,
      source: 'bhd-r',
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: input.payload,
      amountMinor:
        typeof input.payload.amountMinor === 'string' || typeof input.payload.amountMinor === 'number'
          ? String(input.payload.amountMinor)
          : undefined,
      currency: typeof input.payload.currency === 'string' ? input.payload.currency : undefined,
      propertyId: typeof input.payload.propertyId === 'string' ? input.payload.propertyId : undefined,
      unitId: typeof input.payload.unitId === 'string' ? input.payload.unitId : undefined,
      memo: typeof input.payload.memo === 'string' ? input.payload.memo : undefined,
      sourceRefs: {
        eventId: input.eventId,
        bookingId:
          typeof input.payload.bookingId === 'string' ? input.payload.bookingId : input.aggregateId,
        invoiceId: typeof input.payload.invoiceId === 'string' ? input.payload.invoiceId : undefined,
        paymentId: typeof input.payload.paymentId === 'string' ? input.payload.paymentId : undefined,
      },
    };

    let response: Response;
    try {
      response = await fetch(link.events_url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'x-bhd-r-event-id': input.eventId,
          'x-bhd-r-topic': input.topic,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      await client.query(
        `UPDATE hisaby_links
         SET last_sync_at = now(),
             last_sync_status = 'failed',
             last_sync_error = $2,
             updated_at = now()
         WHERE organization_id = $1::uuid`,
        [input.organizationId, error instanceof Error ? error.message.slice(0, 500) : 'fetch_failed'],
      );
      await client.query('COMMIT');
      throw error;
    }

    if (!response.ok) {
      const detail = `HTTP ${response.status}`;
      await client.query(
        `UPDATE hisaby_links
         SET last_sync_at = now(),
             last_sync_status = 'failed',
             last_sync_error = $2,
             updated_at = now()
         WHERE organization_id = $1::uuid`,
        [input.organizationId, detail],
      );
      await client.query('COMMIT');
      throw new Error(`hisaby_push_rejected|${detail}`);
    }

    await client.query(
      `UPDATE hisaby_links
       SET last_sync_at = now(),
           last_sync_status = 'ok',
           last_sync_error = NULL,
           updated_at = now()
       WHERE organization_id = $1::uuid`,
      [input.organizationId],
    );
    await client.query('COMMIT');
    return { pushed: true, status: response.status };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
