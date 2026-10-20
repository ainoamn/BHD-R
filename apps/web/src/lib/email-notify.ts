import 'server-only';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { outboxEvents } from '@bhd-r/db';
import { elevatedTx, rowsOf, type ElevatedTx } from '@/lib/elevated-db';
import { sendQueuedEmailsSoon } from '@/lib/email-outbox';
import { renderBrandedEmail, type BrandedEmailInput } from '@/lib/email-template';
import { normalizeEmailInput } from '@/lib/email-address';
import { publicWebOrigin } from '@/lib/seo';

/** Any transaction (tenant-scoped or elevated) that may write to the outbox. */
export type OutboxWriter = {
  insert: (table: typeof outboxEvents) => {
    values: (row: typeof outboxEvents.$inferInsert) => PromiseLike<unknown>;
  };
};

export type BrandedEmailJob = BrandedEmailInput & {
  orgId: string | null;
  recipient: string | null | undefined;
  subject: string;
  aggregateType: string;
  aggregateId: string;
  /** Reminders carry one; a reminder already queued under the same key is not queued again. */
  dedupeKey?: string | undefined;
};

/** A real mailbox: placeholder addresses minted for phone-only accounts never receive mail. */
export function emailableAddress(value: string | null | undefined): string | null {
  const address = normalizeEmailInput(value ?? '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) return null;
  if (address.endsWith('@identity.bhd-om.local')) return null;
  return address;
}

export function appLink(path: string): string {
  return `${publicWebOrigin()}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Queues one branded email in the same transaction as the change it reports. */
export async function queueBrandedEmail(tx: OutboxWriter, job: BrandedEmailJob): Promise<boolean> {
  const recipient = emailableAddress(job.recipient);
  if (!recipient) return false;
  const notificationId = randomUUID();
  const body = renderBrandedEmail(job, {
    origin: publicWebOrigin(),
    seed: job.dedupeKey ?? notificationId,
  });
  await tx.insert(outboxEvents).values({
    organizationId: job.orgId,
    topic: 'notification.delivery.requested',
    aggregateType: job.aggregateType,
    aggregateId: job.aggregateId,
    payload: {
      correlationId: randomUUID(),
      organizationId: job.orgId,
      notificationId,
      channel: 'email',
      recipient,
      subject: job.subject.slice(0, 300),
      text: body.text,
      html: body.html,
      ...(job.dedupeKey ? { dedupeKey: job.dedupeKey } : {}),
    },
  });
  return true;
}

export type EmailRecipient = { email: string | null; name: string | null };

export type EmailContent = Omit<
  BrandedEmailJob,
  'recipient' | 'recipientName' | 'orgId' | 'aggregateType' | 'aggregateId' | 'dedupeKey'
>;

export type EmailAudience = {
  parties?: ReadonlyArray<string | null | undefined>;
  users?: ReadonlyArray<string | null | undefined>;
  /** The organization's owners, admins and property managers, plus the property's owner. */
  managersOf?: { orgId: string; propertyId?: string | null | undefined };
  /** Active members holding any of these role keys (e.g. building_guard). */
  rolesOf?: { orgId: string; roles: readonly string[] };
  addresses?: ReadonlyArray<EmailRecipient>;
};

const MANAGER_ROLES = ['organization_owner', 'organization_admin', 'property_manager'];
const AUDIENCE_MAX = 15;
const UUID = /^[0-9a-f-]{36}$/i;

function ids(values: ReadonlyArray<string | null | undefined> | undefined): string[] {
  return [
    ...new Set((values ?? []).filter((value): value is string => !!value && UUID.test(value))),
  ];
}

async function resolveAudience(tx: ElevatedTx, audience: EmailAudience): Promise<EmailRecipient[]> {
  const found: EmailRecipient[] = [...(audience.addresses ?? [])];
  const partyIds = ids(audience.parties);
  if (partyIds.length) {
    // Prefer a real party mailbox; if the party was minted for a phone-only account
    // (@identity.bhd-om.local), fall back to the linked user email when metadata.userId is set.
    found.push(
      ...rowsOf<EmailRecipient>(
        await tx.execute(sql`
          select coalesce(
                   nullif(
                     case
                       when p.email is null then null
                       when p.email ilike '%@identity.bhd-om.local' then null
                       else p.email
                     end,
                     ''
                   ),
                   u.email
                 ) as email,
                 coalesce(nullif(p.display_name, ''), u.display_name) as name
          from parties p
          left join users u
            on u.id = nullif(p.metadata->>'userId', '')::uuid
           and u.disabled_at is null
          where p.id = any(${`{${partyIds.join(',')}}`}::uuid[])`),
      ),
    );
  }
  const userIds = ids(audience.users);
  if (userIds.length) {
    found.push(
      ...rowsOf<EmailRecipient>(
        await tx.execute(sql`select email, display_name as name from users
          where id = any(${`{${userIds.join(',')}}`}::uuid[]) and disabled_at is null`),
      ),
    );
  }
  const managers = audience.managersOf;
  if (managers && UUID.test(managers.orgId)) {
    const propertyId =
      managers.propertyId && UUID.test(managers.propertyId) ? managers.propertyId : null;
    found.push(
      ...rowsOf<EmailRecipient>(
        await tx.execute(sql`select distinct u.email, u.display_name as name
          from memberships m join users u on u.id = m.user_id
          where m.organization_id = ${managers.orgId}::uuid and m.status = 'active'
            and u.disabled_at is null
            and (m.role_key = any(${`{${MANAGER_ROLES.join(',')}}`}::text[])
              or (${propertyId}::uuid is not null and m.role_key = 'property_owner'
                and m.party_id = (select owner_party_id from properties where id = ${propertyId}::uuid)))
          limit ${AUDIENCE_MAX}`),
      ),
    );
  }
  const rolesOf = audience.rolesOf;
  if (rolesOf && UUID.test(rolesOf.orgId) && rolesOf.roles.length) {
    const roleList = rolesOf.roles.filter((role) => /^[a-z_]{2,40}$/.test(role));
    if (roleList.length) {
      found.push(
        ...rowsOf<EmailRecipient>(
          await tx.execute(sql`select distinct u.email, u.display_name as name
            from memberships m join users u on u.id = m.user_id
            where m.organization_id = ${rolesOf.orgId}::uuid and m.status = 'active'
              and u.disabled_at is null
              and m.role_key = any(${`{${roleList.join(',')}}`}::text[])
            limit ${AUDIENCE_MAX}`),
        ),
      );
    }
  }
  const seen = new Set<string>();
  return found.filter((person) => {
    const address = emailableAddress(person.email);
    if (!address || seen.has(address)) return false;
    seen.add(address);
    return true;
  });
}

export type NotifyInput = {
  orgId: string | null;
  aggregateType: string;
  aggregateId: string;
  audience: EmailAudience;
  content: (recipient: EmailRecipient) => EmailContent | null;
  dedupeKey?: string | undefined;
};

async function queueForAudience(tx: ElevatedTx, input: NotifyInput): Promise<number> {
  const people = (await resolveAudience(tx, input.audience)).slice(0, AUDIENCE_MAX);
  let count = 0;
  for (const person of people) {
    const content = input.content(person);
    if (!content) continue;
    const sent = await queueBrandedEmail(tx, {
      ...content,
      orgId: input.orgId,
      recipient: person.email,
      recipientName: person.name,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${person.email}` : undefined,
    });
    if (sent) count += 1;
  }
  return count;
}

function logFailure(input: NotifyInput, error: unknown) {
  console.error(
    'email notice not queued',
    input.aggregateType,
    error instanceof Error ? error.message : 'unknown',
  );
}

/**
 * Emails everyone in `audience` once the change they hear about is committed. Recipients are read
 * with elevated access, so any feature can notify a tenant, an owner or the staff without its own
 * session seeing their addresses. Never throws: a notice must not undo the action it reports.
 */
export async function notifyByEmail(input: NotifyInput): Promise<number> {
  try {
    const queued = await elevatedTx((tx) => queueForAudience(tx, input));
    if (queued) sendQueuedEmailsSoon();
    return queued;
  } catch (error) {
    logFailure(input, error);
    return 0;
  }
}

/**
 * The same, inside the caller's own transaction (in a savepoint), so the email exists only if the
 * change commits. The caller's session must be able to read the recipients' rows.
 */
export async function notifyInTx(tx: ElevatedTx, input: NotifyInput): Promise<number> {
  try {
    const queued = await tx.transaction((savepoint) => queueForAudience(savepoint, input));
    if (queued) sendQueuedEmailsSoon();
    return queued;
  } catch (error) {
    logFailure(input, error);
    return 0;
  }
}
