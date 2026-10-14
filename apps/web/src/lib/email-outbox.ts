import 'server-only';
import { sql } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { elevatedTx, rowsOf } from '@/lib/elevated-db';

/** Same topic and claim rules as the worker's dispatcher, so both can run without double sends. */
const TOPIC = 'notification.delivery.requested';
export const EMAIL_MAX_ATTEMPTS = 6;
/** A notice that could not go out within this window is stale; it is never sent late. */
export const EMAIL_MAX_AGE_HOURS = 12;
const BATCH = 10;

const messageSchema = z.object({
  channel: z.literal('email'),
  recipient: z.email().max(320),
  subject: z.string().min(1).max(300),
  text: z.string().min(1).max(50_000),
  html: z.string().max(200_000).optional(),
});

type Outcome = 'sent' | 'retry' | 'reject';

export type EmailDeliveryState = 'sent' | 'sending' | 'failed';

export type DispatchSummary = {
  configured: boolean;
  sent: number;
  retried: number;
  dropped: number;
};

function settings(): { key: string; from: string } | null {
  const key = process.env.RESEND_API_KEY?.trim();
  const sender = process.env.RESEND_FROM_EMAIL?.trim();
  // The shared sender address may carry another product's name; BHD R mail always says BHD R.
  const address = sender?.match(/<([^>]+)>/)?.[1]?.trim() ?? sender;
  if (!key || !address?.includes('@')) return null;
  return { key, from: `BHD R <${address}>` };
}

export function emailDeliveryState(row: {
  publishedAt: Date | string | null;
  occurredAt: Date | string;
  attempts: number;
}): EmailDeliveryState {
  if (row.publishedAt) return 'sent';
  const age = Date.now() - new Date(row.occurredAt).getTime();
  if (row.attempts >= EMAIL_MAX_ATTEMPTS || age > EMAIL_MAX_AGE_HOURS * 3_600_000) return 'failed';
  return 'sending';
}

async function send(
  config: { key: string; from: string },
  id: string,
  message: z.infer<typeof messageSchema>,
): Promise<Outcome> {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(8_000),
      headers: {
        authorization: `Bearer ${config.key}`,
        'content-type': 'application/json',
        'idempotency-key': `bhd-r-outbox-${id}`,
      },
      body: JSON.stringify({
        from: config.from,
        to: [message.recipient],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        headers: { 'X-BHD-R-Notification-Id': id },
      }),
    });
    if (response.ok) return 'sent';
    // 400/422: the message itself is unacceptable; 401/403/429/5xx can clear up later.
    return response.status === 400 || response.status === 422 ? 'reject' : 'retry';
  } catch {
    return 'retry';
  }
}

async function dispatchBatch(config: {
  key: string;
  from: string;
}): Promise<DispatchSummary & { picked: number }> {
  return elevatedTx(async (tx) => {
    const rows = rowsOf<{ id: string; payload: unknown }>(
      await tx.execute(sql`
        select id::text, payload from outbox_events
        where topic = ${TOPIC} and published_at is null and attempts < ${EMAIL_MAX_ATTEMPTS}
          and occurred_at > now() - make_interval(hours => ${EMAIL_MAX_AGE_HOURS})
          and occurred_at + make_interval(secs => case when attempts = 0 then 0
            else least(3600, 60 * power(2, attempts)::integer) end) <= now()
        order by occurred_at
        for update skip locked
        limit ${BATCH}
      `),
    );
    const summary = { configured: true, sent: 0, retried: 0, dropped: 0, picked: rows.length };
    for (const row of rows) {
      const parsed = messageSchema.safeParse(row.payload);
      const outcome: Outcome = parsed.success ? await send(config, row.id, parsed.data) : 'reject';
      if (outcome === 'sent') {
        summary.sent += 1;
        await tx.execute(sql`update outbox_events
          set published_at = now(), attempts = attempts + 1 where id = ${row.id}::uuid`);
      } else if (outcome === 'retry') {
        summary.retried += 1;
        await tx.execute(
          sql`update outbox_events set attempts = attempts + 1 where id = ${row.id}::uuid`,
        );
      } else {
        summary.dropped += 1;
        await tx.execute(sql`update outbox_events
          set attempts = ${EMAIL_MAX_ATTEMPTS} where id = ${row.id}::uuid`);
        console.warn('email dropped', row.id, parsed.success ? 'rejected' : 'invalid');
      }
    }
    return summary;
  }, 30_000);
}

/** Sends due queued emails through Resend until the queue is empty or the time budget ends. */
export async function dispatchQueuedEmails(
  options: { budgetMs?: number } = {},
): Promise<DispatchSummary> {
  const config = settings();
  const total: DispatchSummary = { configured: Boolean(config), sent: 0, retried: 0, dropped: 0 };
  if (!config) return total;
  const deadline = Date.now() + (options.budgetMs ?? 15_000);
  do {
    const batch = await dispatchBatch(config);
    total.sent += batch.sent;
    total.retried += batch.retried;
    total.dropped += batch.dropped;
    if (batch.picked < BATCH || batch.retried === batch.picked) break;
  } while (Date.now() < deadline);
  return total;
}

/**
 * Sends what is queued once the current response has gone out (the writing transaction has
 * committed by then). Safe to call from any request; a no-op where email is not configured.
 */
export function sendQueuedEmailsSoon(): void {
  if (!settings()) return;
  try {
    after(async () => {
      try {
        await dispatchQueuedEmails({ budgetMs: 10_000 });
      } catch (error) {
        console.error('email dispatch failed', error instanceof Error ? error.message : 'unknown');
      }
    });
  } catch {
    // Outside a request scope: the scheduled run sends it.
  }
}
