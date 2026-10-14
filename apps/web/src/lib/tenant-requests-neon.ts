import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import {
  cheques,
  memberships,
  operationalRequests,
  outboxEvents,
  parties,
  properties,
  units,
  users,
  workflowEvents,
} from '@bhd-r/db';
import { sendQueuedEmailsSoon } from '@/lib/email-outbox';
import { escapeHtml } from '@/lib/lease-booking-contract';
import type { PendingApprovalItem } from '@/lib/pending-approvals-shared';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';
import { publicWebOrigin } from '@/lib/seo';
import { findTenancyLease, findTenancyRequestLink, withinTenancyLink } from '@/lib/tenancy-neon';
import {
  OPEN_TENANT_REQUEST,
  TENANT_REQUEST_SOURCE,
  requestNeedsCheque,
  requestNeedsDate,
  tenantRequestFromRow,
  tenantRequestTypeLabel,
  type OwnerTenantRequest,
  type TenantRequestReply,
  type TenantRequestStatus,
  type TenantRequestType,
} from '@/lib/tenant-requests-shared';

type Tx = Parameters<Parameters<typeof withinViewerTenant>[1]>[0];

const OWNER_ROLES = ['organization_owner', 'organization_admin', 'property_manager'];
const EMAIL_RECIPIENTS_MAX = 12;
const OWNER_LIST_LIMIT = 100;
const REPLIES_MAX = 40;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function fail(code: string): never {
  throw new Error(code);
}

function meta(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function reference(): string {
  const day = new Date().toISOString().slice(2, 10).replaceAll('-', '');
  return `TR-${day}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function replies(value: unknown): TenantRequestReply[] {
  return Array.isArray(value) ? (value as TenantRequestReply[]) : [];
}

async function queueEmail(
  tx: Tx,
  input: {
    orgId: string;
    requestId: string;
    recipient: string;
    name: string | null;
    subject: string;
    lines: string[];
    link: string;
    linkLabel: string;
  },
) {
  const recipient = input.recipient.trim().toLowerCase();
  if (!recipient.includes('@') || recipient.endsWith('@identity.bhd-om.local')) return;
  const greeting = input.name ? `مرحباً ${input.name}،` : 'مرحباً،';
  await tx.insert(outboxEvents).values({
    organizationId: input.orgId,
    topic: 'notification.delivery.requested',
    aggregateType: 'tenant_request',
    aggregateId: input.requestId,
    payload: {
      correlationId: randomUUID(),
      organizationId: input.orgId,
      notificationId: randomUUID(),
      channel: 'email',
      recipient,
      subject: input.subject,
      text: [
        greeting,
        '',
        ...input.lines,
        '',
        `${input.linkLabel}: ${input.link}`,
        '',
        'BHD R',
      ].join('\n'),
      html: `<div dir="rtl"><p>${escapeHtml(greeting)}</p>${input.lines
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join('')}<p><a href="${escapeHtml(input.link)}">${escapeHtml(
        input.linkLabel,
      )}</a></p><p>BHD R</p></div>`,
    },
  });
}

/** The landlord's people who handle tenant requests for this property. */
async function ownerRecipients(tx: Tx, orgId: string, propertyId: string | null) {
  const [property] = propertyId
    ? await tx
        .select({ ownerPartyId: properties.ownerPartyId })
        .from(properties)
        .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)))
        .limit(1)
    : [];
  const rows = await tx
    .selectDistinct({ email: users.email, name: users.displayName })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.organizationId, orgId),
        eq(memberships.status, 'active'),
        sql`${users.disabledAt} is null`,
        or(
          inArray(memberships.roleKey, OWNER_ROLES),
          sql`${memberships.permissions} @> '["request.update"]'::jsonb`,
          ...(property?.ownerPartyId
            ? [
                and(
                  eq(memberships.roleKey, 'property_owner'),
                  eq(memberships.partyId, property.ownerPartyId),
                ),
              ]
            : []),
        ),
      ),
    )
    .limit(EMAIL_RECIPIENTS_MAX);
  return rows.filter((row) => row.email.includes('@'));
}

export type TenantRequestInput = {
  leaseId: string;
  type: TenantRequestType;
  subject?: string | undefined;
  description?: string | undefined;
  priority?: 'low' | 'normal' | 'high' | 'urgent' | undefined;
  chequeId?: string | undefined;
  proposedDate?: string | undefined;
};

/** The tenant sends a request about their lease; it lands with the landlord at once. */
export async function createTenantRequest(claims: SessionClaims, input: TenantRequestInput) {
  const lease = await findTenancyLease(claims.sub, input.leaseId);
  if (!lease) fail('tenant_request_not_found');
  if (requestNeedsCheque(input.type) && !input.chequeId) fail('tenant_request_invalid');
  if (requestNeedsDate(input.type) && !(input.proposedDate && ISO_DATE.test(input.proposedDate))) {
    fail('tenant_request_invalid');
  }
  const { link } = lease;
  const orgId = link.organizationId;
  const created = await withinTenancyLink(claims.sub, link, async (tx) => {
    let cheque: {
      id: string;
      chequeNumber: string;
      dueOn: string;
      amountMinor: bigint;
      currency: string;
      reviewStatus: string;
    } | null = null;
    if (requestNeedsCheque(input.type)) {
      const [row] = await tx
        .select({
          id: cheques.id,
          chequeNumber: cheques.chequeNumber,
          dueOn: cheques.dueOn,
          amountMinor: cheques.amountMinor,
          currency: cheques.currency,
          reviewStatus: cheques.reviewStatus,
        })
        .from(cheques)
        .where(
          and(
            eq(cheques.id, input.chequeId!),
            eq(cheques.organizationId, orgId),
            eq(cheques.leaseId, lease.leaseId),
          ),
        )
        .limit(1);
      if (!row || !['pending', 'accepted'].includes(row.reviewStatus)) {
        fail('tenant_request_invalid');
      }
      cheque = { ...row, dueOn: String(row.dueOn) };
      if (input.type === 'cheque_postpone' && input.proposedDate! <= cheque.dueOn) {
        fail('tenant_request_invalid');
      }
    }
    const open = await tx
      .select({ id: operationalRequests.id, metadata: operationalRequests.metadata })
      .from(operationalRequests)
      .where(
        and(
          eq(operationalRequests.organizationId, orgId),
          eq(operationalRequests.requesterPartyId, link.partyId),
          eq(operationalRequests.source, TENANT_REQUEST_SOURCE),
          eq(operationalRequests.type, input.type),
          inArray(operationalRequests.status, [...OPEN_TENANT_REQUEST] as TenantRequestStatus[]),
        ),
      )
      .limit(50);
    const clash = open.some((row) => {
      const data = meta(row.metadata);
      if (cheque) return data.chequeId === cheque.id;
      return (
        input.type !== 'maintenance' && input.type !== 'other' && data.leaseId === lease.leaseId
      );
    });
    if (clash) fail('tenant_request_duplicate');

    const [tenant] = await tx
      .select({ name: parties.displayName })
      .from(parties)
      .where(and(eq(parties.id, link.partyId), eq(parties.organizationId, orgId)))
      .limit(1);
    const subject = input.subject?.trim().slice(0, 200) || tenantRequestTypeLabel(input.type, true);
    const description = input.description?.trim().slice(0, 2000) || null;
    const priority =
      input.priority ??
      (input.type === 'cheque_stop' || input.type === 'cheque_postpone' ? 'high' : 'normal');
    const ref = reference();
    const [row] = await tx
      .insert(operationalRequests)
      .values({
        organizationId: orgId,
        reference: ref,
        type: input.type,
        requesterPartyId: link.partyId,
        propertyId: lease.propertyId,
        unitId: lease.unitId,
        subject,
        description,
        priority,
        status: 'pending',
        source: TENANT_REQUEST_SOURCE,
        metadata: {
          leaseId: lease.leaseId,
          contractId: lease.contractId,
          requesterUserId: claims.sub,
          ...(cheque
            ? {
                chequeId: cheque.id,
                chequeNumber: cheque.chequeNumber,
                chequeDueOn: cheque.dueOn,
                chequeAmountMinor: cheque.amountMinor.toString(),
                currency: cheque.currency,
              }
            : { currency: lease.currency }),
          ...(input.proposedDate ? { proposedDate: input.proposedDate } : {}),
          replies: [],
        },
      })
      .returning({ id: operationalRequests.id });
    if (!row) fail('create_failed');
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'operational_request',
      resourceId: row.id,
      eventType: 'tenant_request.created',
      toStatus: 'pending',
      metadata: { reference: ref, type: input.type, leaseId: lease.leaseId },
    });

    const typeLabel = tenantRequestTypeLabel(input.type, true);
    const people = await ownerRecipients(tx, orgId, lease.propertyId);
    const ownerLink = `${publicWebOrigin()}/ar/owner/tenant-requests?focus=${row.id}`;
    for (const person of people) {
      await queueEmail(tx, {
        orgId,
        requestId: row.id,
        recipient: person.email,
        name: person.name,
        subject: `طلب جديد من المستأجر: ${typeLabel} (${ref})`,
        lines: [
          tenant?.name
            ? `أرسل المستأجر ${tenant.name} طلباً جديداً: ${typeLabel}.`
            : `أرسل المستأجر طلباً جديداً: ${typeLabel}.`,
          `الموضوع: ${subject}`,
          ...(cheque ? [`الشيك رقم ${cheque.chequeNumber} المستحق في ${cheque.dueOn}.`] : []),
          ...(input.proposedDate ? [`التاريخ المقترح: ${input.proposedDate}`] : []),
          'افتح الطلب في BHD R للرد عليه والموافقة أو الرفض.',
        ],
        link: ownerLink,
        linkLabel: 'فتح طلبات المستأجرين',
      });
    }
    return { id: row.id, reference: ref, notified: people.length };
  });
  sendQueuedEmailsSoon();
  return created;
}

/** The tenant withdraws a request still open, or adds a note to it. */
export async function actOnTenantRequest(
  claims: SessionClaims,
  requestId: string,
  input: { action: 'cancel' | 'reply'; note?: string | undefined },
) {
  const link = await findTenancyRequestLink(claims.sub, requestId);
  if (!link) fail('tenant_request_not_found');
  const note = input.note?.trim().slice(0, 1000) ?? '';
  if (input.action === 'reply' && !note) fail('tenant_request_invalid');
  const orgId = link.organizationId;
  const result = await withinTenancyLink(claims.sub, link, async (tx) => {
    const [row] = await tx
      .select()
      .from(operationalRequests)
      .where(
        and(
          eq(operationalRequests.id, requestId),
          eq(operationalRequests.organizationId, orgId),
          eq(operationalRequests.requesterPartyId, link.partyId),
          eq(operationalRequests.source, TENANT_REQUEST_SOURCE),
        ),
      )
      .for('update')
      .limit(1);
    if (!row) fail('tenant_request_not_found');
    if (!OPEN_TENANT_REQUEST.has(row.status)) fail('tenant_request_closed');
    if (input.action === 'cancel' && row.status !== 'pending') fail('tenant_request_closed');
    const data = meta(row.metadata);
    const [tenant] = await tx
      .select({ name: parties.displayName })
      .from(parties)
      .where(eq(parties.id, link.partyId))
      .limit(1);
    const reply: TenantRequestReply = {
      at: new Date().toISOString(),
      by: 'tenant',
      name: tenant?.name ?? null,
      note: note || 'سحب المستأجر الطلب.',
      ...(input.action === 'cancel' ? { status: 'cancelled' as const } : {}),
    };
    const status = input.action === 'cancel' ? 'cancelled' : row.status;
    await tx
      .update(operationalRequests)
      .set({
        status,
        metadata: { ...data, replies: [...replies(data.replies), reply].slice(-REPLIES_MAX) },
        updatedAt: new Date(),
        ...(input.action === 'cancel' ? { completedAt: new Date() } : {}),
      })
      .where(eq(operationalRequests.id, row.id));
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'operational_request',
      resourceId: row.id,
      eventType: input.action === 'cancel' ? 'tenant_request.cancelled' : 'tenant_request.replied',
      fromStatus: row.status,
      toStatus: status,
      metadata: { reference: row.reference },
    });
    const people = await ownerRecipients(tx, orgId, row.propertyId);
    const typeLabel = tenantRequestTypeLabel(
      tenantRequestFromRow({ ...row, unitCode: null, unitAr: null, unitEn: null }, orgId).type,
      true,
    );
    for (const person of people) {
      await queueEmail(tx, {
        orgId,
        requestId: row.id,
        recipient: person.email,
        name: person.name,
        subject:
          input.action === 'cancel'
            ? `سحب المستأجر طلبه ${row.reference}`
            : `رد جديد من المستأجر على الطلب ${row.reference}`,
        lines: [
          input.action === 'cancel'
            ? `سحب المستأجر ${tenant?.name ?? ''} طلبه (${typeLabel}).`
            : `أضاف المستأجر ${tenant?.name ?? ''} رداً على الطلب (${typeLabel}).`,
          ...(note ? [`«${note}»`] : []),
        ],
        link: `${publicWebOrigin()}/ar/owner/tenant-requests?focus=${row.id}`,
        linkLabel: 'فتح طلبات المستأجرين',
      });
    }
    return { id: row.id, status };
  });
  sendQueuedEmailsSoon();
  return result;
}

export function canHandleTenantRequests(claims: SessionClaims): boolean {
  return (
    Boolean(claims.organizationId) &&
    (hasPermission(claims, 'request.update') || claims.roles.includes('property_owner'))
  );
}

function ownerScope(claims: SessionClaims) {
  const orgId = claims.organizationId;
  if (!orgId) fail('forbidden');
  const scoped = ownerPartyScope(claims);
  return and(
    eq(operationalRequests.organizationId, orgId),
    eq(operationalRequests.source, TENANT_REQUEST_SOURCE),
    ...(scoped ? [eq(properties.ownerPartyId, scoped)] : []),
  );
}

/** Requests tenants sent the organization, newest first; owner-scoped users see their own. */
export async function listOwnerTenantRequests(
  claims: SessionClaims,
): Promise<OwnerTenantRequest[]> {
  if (!canHandleTenantRequests(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    const rows = await tx
      .select({
        id: operationalRequests.id,
        reference: operationalRequests.reference,
        type: operationalRequests.type,
        subject: operationalRequests.subject,
        description: operationalRequests.description,
        priority: operationalRequests.priority,
        status: operationalRequests.status,
        metadata: operationalRequests.metadata,
        createdAt: operationalRequests.createdAt,
        updatedAt: operationalRequests.updatedAt,
        unitCode: units.code,
        unitAr: units.nameAr,
        unitEn: units.nameEn,
        tenantName: parties.displayName,
        propertyId: operationalRequests.propertyId,
        propertyNameAr: properties.nameAr,
        propertyNameEn: properties.nameEn,
      })
      .from(operationalRequests)
      .leftJoin(units, eq(units.id, operationalRequests.unitId))
      .leftJoin(properties, eq(properties.id, operationalRequests.propertyId))
      .leftJoin(parties, eq(parties.id, operationalRequests.requesterPartyId))
      .where(ownerScope(claims))
      .orderBy(desc(operationalRequests.createdAt))
      .limit(OWNER_LIST_LIMIT);
    return rows.map((row) => ({
      ...tenantRequestFromRow(row, orgId),
      tenantName: row.tenantName,
      propertyId: row.propertyId,
      propertyNameAr: row.propertyNameAr,
      propertyNameEn: row.propertyNameEn,
    }));
  });
}

export type OwnerDecision = 'approve' | 'reject' | 'in_progress' | 'on_hold' | 'complete' | 'reply';

const DECISION_STATUS: Record<Exclude<OwnerDecision, 'reply'>, TenantRequestStatus> = {
  approve: 'approved',
  reject: 'rejected',
  in_progress: 'in_progress',
  on_hold: 'on_hold',
  complete: 'completed',
};

/**
 * The landlord answers a tenant request. Approving a cheque postponement moves the cheque to the
 * new date; approving a stop marks the cheque cancelled. Either way the tenant is emailed.
 */
export async function decideTenantRequest(
  claims: SessionClaims,
  requestId: string,
  input: { action: OwnerDecision; note?: string | undefined; date?: string | undefined },
) {
  if (!canHandleTenantRequests(claims)) fail('forbidden');
  const note = input.note?.trim().slice(0, 1000) ?? '';
  if ((input.action === 'reject' || input.action === 'reply') && !note) {
    fail('tenant_request_invalid');
  }
  const orgId = claims.organizationId!;
  const result = await withinViewerTenant(claims, async (tx) => {
    const [found] = await tx
      .select({ id: operationalRequests.id })
      .from(operationalRequests)
      .leftJoin(properties, eq(properties.id, operationalRequests.propertyId))
      .where(and(eq(operationalRequests.id, requestId), ownerScope(claims)))
      .limit(1);
    if (!found) fail('tenant_request_not_found');
    const [row] = await tx
      .select()
      .from(operationalRequests)
      .where(eq(operationalRequests.id, found.id))
      .for('update')
      .limit(1);
    if (!row) fail('tenant_request_not_found');
    if (!OPEN_TENANT_REQUEST.has(row.status)) fail('tenant_request_closed');
    const data = meta(row.metadata);
    const request = tenantRequestFromRow(
      { ...row, unitCode: null, unitAr: null, unitEn: null },
      orgId,
    );
    const now = new Date();
    let status: TenantRequestStatus =
      input.action === 'reply' ? request.status : DECISION_STATUS[input.action];
    let effect: string | null = null;

    if (input.action === 'approve' && requestNeedsCheque(request.type) && request.chequeId) {
      const leaseId = request.leaseId;
      if (!leaseId) fail('tenant_request_invalid');
      if (request.type === 'cheque_postpone') {
        const date = input.date ?? request.proposedDate;
        if (!date || !ISO_DATE.test(date)) fail('tenant_request_invalid');
        const moved = await tx
          .update(cheques)
          .set({
            dueOn: date,
            reviewNotes: `أُجّل بطلب المستأجر ${row.reference}`,
            updatedAt: now,
          })
          .where(
            and(
              eq(cheques.id, request.chequeId),
              eq(cheques.organizationId, orgId),
              eq(cheques.leaseId, leaseId),
              inArray(cheques.reviewStatus, ['pending', 'accepted']),
            ),
          )
          .returning({ id: cheques.id });
        if (!moved.length) fail('tenant_request_closed');
        effect = `أُجّل الشيك رقم ${request.chequeNumber ?? ''} إلى ${date.split('-').reverse().join('/')}.`;
        data.approvedDate = date;
      } else {
        const stopped = await tx
          .update(cheques)
          .set({
            reviewStatus: 'cancelled',
            reviewedByUserId: claims.sub,
            reviewedAt: now,
            reviewNotes: `أُوقف بطلب المستأجر ${row.reference}`,
            updatedAt: now,
          })
          .where(
            and(
              eq(cheques.id, request.chequeId),
              eq(cheques.organizationId, orgId),
              eq(cheques.leaseId, leaseId),
              inArray(cheques.reviewStatus, ['pending', 'accepted']),
            ),
          )
          .returning({ id: cheques.id });
        if (!stopped.length) fail('tenant_request_closed');
        effect = `أُوقف الشيك رقم ${request.chequeNumber ?? ''}، وتبقى قيمته مستحقة عليك بطريقة سداد أخرى.`;
      }
      status = 'completed';
    }

    const [actor] = await tx
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, claims.sub))
      .limit(1);
    const reply: TenantRequestReply = {
      at: now.toISOString(),
      by: 'owner',
      name: actor?.name ?? null,
      note: [note, effect].filter(Boolean).join(' — ') || '—',
      ...(status !== row.status ? { status } : {}),
    };
    await tx
      .update(operationalRequests)
      .set({
        status,
        assignedToUserId: row.assignedToUserId ?? claims.sub,
        metadata: { ...data, replies: [...replies(data.replies), reply].slice(-REPLIES_MAX) },
        updatedAt: now,
        ...(status === 'completed' || status === 'rejected' ? { completedAt: now } : {}),
      })
      .where(eq(operationalRequests.id, row.id));
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'operational_request',
      resourceId: row.id,
      eventType: `tenant_request.${input.action}`,
      fromStatus: row.status,
      toStatus: status,
      metadata: { reference: row.reference, ...(effect ? { effect } : {}) },
    });

    if (row.requesterPartyId) {
      const [tenant] = await tx
        .select({ email: parties.email, name: parties.displayName })
        .from(parties)
        .where(and(eq(parties.id, row.requesterPartyId), eq(parties.organizationId, orgId)))
        .limit(1);
      if (tenant?.email) {
        const typeLabel = tenantRequestTypeLabel(request.type, true);
        const verdict =
          status === row.status
            ? 'أضاف المالك رداً على طلبك.'
            : status === 'approved' || status === 'completed'
              ? 'وافق المالك على طلبك.'
              : status === 'rejected'
                ? 'رفض المالك طلبك.'
                : status === 'in_progress'
                  ? 'بدأ المالك تنفيذ طلبك.'
                  : 'علّق المالك طلبك مؤقتاً.';
        await queueEmail(tx, {
          orgId,
          requestId: row.id,
          recipient: tenant.email,
          name: tenant.name,
          subject: `تحديث على طلبك ${row.reference}: ${typeLabel}`,
          lines: [
            verdict,
            ...(effect ? [effect] : []),
            ...(note ? [`ملاحظة المالك: «${note}»`] : []),
          ],
          link: `${publicWebOrigin()}/ar/tenant/requests`,
          linkLabel: 'فتح طلباتي',
        });
      }
    }
    return { id: row.id, status };
  });
  sendQueuedEmailsSoon();
  return result;
}

/** Tenant requests still waiting for the landlord's answer, for the approvals bell. */
export async function tenantRequestApprovalItems(
  claims: SessionClaims,
): Promise<PendingApprovalItem[]> {
  if (!canHandleTenantRequests(claims)) return [];
  return withinViewerTenant(claims, async (tx) => {
    const rows = await tx
      .select({
        id: operationalRequests.id,
        reference: operationalRequests.reference,
        type: operationalRequests.type,
        createdAt: operationalRequests.createdAt,
        propertyId: operationalRequests.propertyId,
        propertyNameAr: properties.nameAr,
        propertyNameEn: properties.nameEn,
        unitCode: units.code,
        party: parties.displayName,
      })
      .from(operationalRequests)
      .leftJoin(properties, eq(properties.id, operationalRequests.propertyId))
      .leftJoin(units, eq(units.id, operationalRequests.unitId))
      .leftJoin(parties, eq(parties.id, operationalRequests.requesterPartyId))
      .where(and(ownerScope(claims), eq(operationalRequests.status, 'pending')))
      .orderBy(operationalRequests.createdAt)
      .limit(50);
    return rows.map((row) => ({
      kind: 'tenant_request' as const,
      id: row.id,
      reference: row.reference,
      propertyId: row.propertyId ?? '',
      propertyNameAr: row.propertyNameAr ?? '',
      propertyNameEn: row.propertyNameEn,
      unitCode: row.unitCode,
      party: row.party,
      contractType: null,
      fromOn: null,
      requestedAt: row.createdAt.toISOString(),
      requestType: row.type,
    }));
  });
}
