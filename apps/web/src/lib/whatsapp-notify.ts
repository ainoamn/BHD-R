import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { outboxEvents, parties } from '@bhd-r/db';
import { elevatedTx, type ElevatedTx } from '@/lib/elevated-db';
import { renderWhatsAppMessage, type WhatsAppDraft } from '@/lib/whatsapp-message';

type OutboxWriter = {
  insert: (table: typeof outboxEvents) => {
    values: (row: typeof outboxEvents.$inferInsert) => PromiseLike<unknown>;
  };
};

/** International digits for Meta Cloud API / wa.me (Omani 8-digit → 968…). */
export function whatsappRecipientDigits(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 8) return `968${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return digits.replace(/^00/, '');
  return null;
}

export type WhatsAppJob = {
  orgId: string | null;
  recipientPhone: string | null | undefined;
  aggregateType: string;
  aggregateId: string;
  dedupeKey?: string | undefined;
  draft: WhatsAppDraft;
};

/** Queue a WhatsApp text notice (drained by send-emails cron when WHATSAPP_* is set). */
export async function queueWhatsApp(tx: OutboxWriter, job: WhatsAppJob): Promise<boolean> {
  const to = whatsappRecipientDigits(job.recipientPhone);
  if (!to) return false;
  const rendered = renderWhatsAppMessage(job.draft, {
    seed: job.dedupeKey ?? job.aggregateId,
  });
  const notificationId = randomUUID();
  await tx.insert(outboxEvents).values({
    organizationId: job.orgId,
    topic: 'notification.delivery.requested',
    aggregateType: job.aggregateType,
    aggregateId: job.aggregateId,
    payload: {
      correlationId: randomUUID(),
      organizationId: job.orgId,
      notificationId,
      channel: 'whatsapp',
      recipient: to,
      text: rendered.textAr.slice(0, 4000),
      ...(job.dedupeKey ? { dedupeKey: job.dedupeKey } : {}),
    },
  });
  return true;
}

export async function notifyPartyWhatsApp(input: {
  orgId: string;
  partyId: string;
  aggregateType: string;
  aggregateId: string;
  dedupeKey: string;
  draft: WhatsAppDraft;
}): Promise<boolean> {
  return elevatedTx((tx) => notifyPartyWhatsAppInTx(tx, input));
}

export async function notifyPartyWhatsAppInTx(
  tx: ElevatedTx,
  input: {
    orgId: string;
    partyId: string;
    aggregateType: string;
    aggregateId: string;
    dedupeKey: string;
    draft: WhatsAppDraft;
  },
): Promise<boolean> {
  const party = await tx.query.parties.findFirst({
    where: and(eq(parties.id, input.partyId), eq(parties.organizationId, input.orgId)),
    columns: { phone: true, displayName: true },
  });
  return queueWhatsApp(tx, {
    orgId: input.orgId,
    recipientPhone: party?.phone,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    dedupeKey: input.dedupeKey,
    draft: {
      ...input.draft,
      recipientName: input.draft.recipientName ?? party?.displayName ?? null,
    },
  });
}
