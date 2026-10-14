import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import {
  cheques,
  leases,
  memberships,
  operationalRequests,
  parties,
  properties,
  units,
  users,
  workflowEvents,
} from '@bhd-r/db';
import { brandUploadedPhoto } from '@/lib/brand-uploaded-photo';
import { queueBrandedEmail } from '@/lib/email-notify';
import { sendQueuedEmailsSoon } from '@/lib/email-outbox';
import type { EmailDetail, EmailTone } from '@/lib/email-template';
import { formatMoney } from '@/lib/format';
import type { PendingApprovalItem } from '@/lib/pending-approvals-shared';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';
import { withElevatedRead } from '@/lib/public-booking-neon';
import { publicWebOrigin } from '@/lib/seo';
import { HANDOVER_PHOTO_MAX } from '@/lib/stay-handover';
import {
  putPrivateObject,
  readPrivateObject,
  s3BucketsReady,
} from '@/lib/upload-property-media-neon';
import {
  findTenancyLease,
  findTenancyRequestLink,
  leaseStatementsInTx,
  withinTenancyLink,
} from '@/lib/tenancy-neon';
import {
  canRecordTenantPayments,
  insertChargeInvoice,
  muscatToday,
  recordChargePayment,
  type ChargePaymentMethod,
} from '@/lib/tenant-charges-neon';
import type { ChargePayment } from '@/lib/tenant-charges-shared';
import { loadTenantPolicy } from '@/lib/tenant-policy-neon';
import { maintenanceBlockedByPolicy } from '@/lib/tenant-policy-shared';
import {
  OPEN_TENANT_REQUEST,
  REQUEST_MEDIA_MAX,
  REQUEST_PHOTO_UPLOAD_MAX_BYTES,
  REQUEST_VIDEO_MAX_BYTES,
  TENANT_REQUEST_PHOTOS_MAX,
  TENANT_REQUEST_SOURCE,
  closureProofMissing,
  emergencyScopeLabel,
  tenantRequestStatusLabel,
  type RequestMediaStage,
  isTenantReport,
  requestNeedsCheque,
  requestNeedsDate,
  requestTakesPhotos,
  tenantRequestFromRow,
  tenantRequestTypeLabel,
  type EmergencyScope,
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
const REQUEST_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
/** Roles that receive and see reports about the company's own staff. */
const STAFF_REPORT_ROLES = ['organization_owner', 'organization_admin'];

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

function requestAwaitsPaymentRow(status: string, payment: ChargePayment): boolean {
  return status === 'on_hold' && payment === 'before_work';
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
    title?: string | undefined;
    tone?: EmailTone | undefined;
    lines: string[];
    details?: EmailDetail[] | undefined;
    link: string;
    linkLabel: string;
  },
) {
  await queueBrandedEmail(tx, {
    orgId: input.orgId,
    recipient: input.recipient,
    subject: input.subject,
    aggregateType: 'tenant_request',
    aggregateId: input.requestId,
    tone: input.tone ?? 'request',
    recipientName: input.name,
    title: input.title ?? input.subject,
    lines: input.lines,
    details: input.details,
    cta: { label: input.linkLabel, url: input.link },
  });
}

function requestTone(type: string): EmailTone {
  return type === 'maintenance' ? 'maintenance' : type.startsWith('report_') ? 'alert' : 'request';
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

/** The company's management, who alone receive reports about its staff. */
async function staffReportRecipients(tx: Tx, orgId: string) {
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
          inArray(memberships.roleKey, STAFF_REPORT_ROLES),
          sql`${memberships.permissions} @> '["organization.members.write"]'::jsonb`,
        ),
      ),
    )
    .limit(EMAIL_RECIPIENTS_MAX);
  return rows.filter((row) => row.email.includes('@'));
}

/** Reports about staff stay with the company's management, never with a building owner. */
export function canSeeStaffReports(claims: SessionClaims): boolean {
  return (
    !ownerPartyScope(claims) &&
    (claims.roles.some((role) => STAFF_REPORT_ROLES.includes(role)) ||
      hasPermission(claims, 'organization.members.write'))
  );
}

export type TenantRequestPhotoInput = {
  data: string;
  takenAt: string;
  source: 'camera' | 'device';
};

export type TenantRequestInput = {
  leaseId: string;
  type: TenantRequestType;
  subject?: string | undefined;
  description?: string | undefined;
  priority?: 'low' | 'normal' | 'high' | 'urgent' | undefined;
  chequeId?: string | undefined;
  proposedDate?: string | undefined;
  /** An urgent maintenance request about the building or people's safety. */
  emergency?: EmergencyScope | undefined;
  staffName?: string | undefined;
  photos?: TenantRequestPhotoInput[] | undefined;
};

/** The tenant's arrears on a lease, read in their own session, when the landlord's rule applies. */
async function blockingArrears(
  tx: Tx,
  orgId: string,
  partyId: string,
  leaseId: string,
): Promise<string | null> {
  const found = (await leaseStatementsInTx(tx, orgId, [leaseId], partyId)).get(leaseId);
  const total = found?.statement.arrears.totalMinor ?? '0';
  return total === '0' ? null : total;
}

/**
 * The tenant sends a request about their lease; it lands with the landlord at once. Ordinary
 * maintenance waits for arrears to be settled when the landlord's rule says so; urgent requests
 * about the building or people's safety always go through, for management to verify.
 */
export async function createTenantRequest(claims: SessionClaims, input: TenantRequestInput) {
  const lease = await findTenancyLease(claims.sub, input.leaseId);
  if (!lease) fail('tenant_request_not_found');
  if (requestNeedsCheque(input.type) && !input.chequeId) fail('tenant_request_invalid');
  if (requestNeedsDate(input.type) && !(input.proposedDate && ISO_DATE.test(input.proposedDate))) {
    fail('tenant_request_invalid');
  }
  if (input.emergency && input.type !== 'maintenance') fail('tenant_request_invalid');
  const photoInputs = input.photos ?? [];
  if (
    photoInputs.length > TENANT_REQUEST_PHOTOS_MAX ||
    (photoInputs.length && !requestTakesPhotos(input.type)) ||
    photoInputs.some(
      (photo) => !REQUEST_IMAGE.test(photo.data) || photo.data.length > HANDOVER_PHOTO_MAX,
    )
  ) {
    fail('tenant_request_photos');
  }
  const { link } = lease;
  const orgId = link.organizationId;
  const gated =
    input.type === 'maintenance' &&
    !input.emergency &&
    maintenanceBlockedByPolicy(await loadTenantPolicy(orgId), lease.propertyId);
  const photos: string[] = [];
  for (const photo of photoInputs) {
    photos.push(await brandUploadedPhoto(photo.data, HANDOVER_PHOTO_MAX));
  }
  const created = await withinTenancyLink(claims.sub, link, async (tx) => {
    if (gated && (await blockingArrears(tx, orgId, link.partyId, lease.leaseId))) {
      fail('tenant_request_arrears');
    }
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
        input.type !== 'maintenance' &&
        input.type !== 'other' &&
        !isTenantReport(input.type) &&
        data.leaseId === lease.leaseId
      );
    });
    if (clash) fail('tenant_request_duplicate');

    const [tenant] = await tx
      .select({ name: parties.displayName, email: parties.email })
      .from(parties)
      .where(and(eq(parties.id, link.partyId), eq(parties.organizationId, orgId)))
      .limit(1);
    const subject = input.subject?.trim().slice(0, 200) || tenantRequestTypeLabel(input.type, true);
    const description = input.description?.trim().slice(0, 2000) || null;
    const priority = input.emergency
      ? 'urgent'
      : (input.priority ??
        (input.type === 'cheque_stop' || input.type === 'cheque_postpone' ? 'high' : 'normal'));
    const staffName =
      input.type === 'report_staff' ? input.staffName?.trim().slice(0, 120) || null : null;
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
          ...(input.emergency ? { emergency: { scope: input.emergency, verified: null } } : {}),
          ...(staffName ? { staffName } : {}),
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
    if (photos.length) {
      const [evidence] = await tx
        .insert(workflowEvents)
        .values({
          organizationId: orgId,
          actorUserId: claims.sub,
          resourceType: 'operational_request',
          resourceId: row.id,
          eventType: 'tenant_request.photos',
          metadata: { reference: ref, photos },
        })
        .returning({ id: workflowEvents.id });
      await tx
        .update(operationalRequests)
        .set({
          metadata: sql`${operationalRequests.metadata} || ${JSON.stringify({
            photosEventId: evidence!.id,
            photoCount: photos.length,
          })}::jsonb`,
        })
        .where(eq(operationalRequests.id, row.id));
    }

    const typeLabel = tenantRequestTypeLabel(input.type, true);
    const people =
      input.type === 'report_staff'
        ? await staffReportRecipients(tx, orgId)
        : await ownerRecipients(tx, orgId, lease.propertyId);
    const ownerLink = `${publicWebOrigin()}/ar/owner/tenant-requests?focus=${row.id}`;
    const maintenanceLink = `${publicWebOrigin()}/ar/owner/maintenance?focus=${row.id}`;
    const kind = isTenantReport(input.type) ? 'بلاغ' : 'طلب';
    for (const person of people) {
      await queueEmail(tx, {
        orgId,
        requestId: row.id,
        recipient: person.email,
        name: person.name,
        subject: `${input.emergency ? '🚨 عاجل — ' : ''}${kind} جديد من المستأجر: ${typeLabel} (${ref})`,
        title: `${kind} جديد وصلك من المستأجر`,
        tone: input.emergency ? 'alert' : requestTone(input.type),
        details: [
          { label: 'رقم الطلب', value: ref },
          { label: 'النوع', value: typeLabel },
          { label: 'المستأجر', value: tenant?.name ?? '—' },
          {
            label: 'الأولوية',
            value: priority === 'urgent' ? 'عاجلة' : priority === 'high' ? 'مرتفعة' : 'عادية',
          },
        ],
        lines: [
          tenant?.name
            ? `أرسل المستأجر ${tenant.name} ${kind}اً جديداً: ${typeLabel}.`
            : `أرسل المستأجر ${kind}اً جديداً: ${typeLabel}.`,
          ...(input.emergency
            ? [
                `وصفه المستأجر بأنه مستعجل: ${emergencyScopeLabel(input.emergency, true)}. تحقّق من صحة الحالة.`,
              ]
            : []),
          `الموضوع: ${subject}`,
          ...(staffName ? [`الموظف المعني: ${staffName}`] : []),
          ...(cheque ? [`الشيك رقم ${cheque.chequeNumber} المستحق في ${cheque.dueOn}.`] : []),
          ...(input.proposedDate ? [`التاريخ المقترح: ${input.proposedDate}`] : []),
          ...(photos.length ? [`أرفق ${photos.length} صورة.`] : []),
          'افتحه في BHD R للرد عليه.',
        ],
        link: input.type === 'maintenance' ? maintenanceLink : ownerLink,
        linkLabel:
          input.type === 'maintenance' ? 'فتح بلاغات الصيانة' : 'فتح طلبات وبلاغات المستأجرين',
      });
    }
    if (tenant?.email) {
      await queueEmail(tx, {
        orgId,
        requestId: row.id,
        recipient: tenant.email,
        name: tenant.name,
        subject: `استلمنا ${kind}ك ${ref}: ${typeLabel}`,
        title: `وصل ${kind}ك بأمان، ونحن عليه`,
        tone: requestTone(input.type),
        details: [
          { label: 'رقم المرجع', value: ref },
          { label: 'النوع', value: typeLabel },
          { label: 'الموضوع', value: subject },
          { label: 'الحالة', value: 'بانتظار رد الإدارة' },
        ],
        lines: [
          `شكراً لأنك أخبرتنا. وصل ${kind}ك إلى المسؤولين عن العقار مباشرة، وسنرسل لك كل تحديث عليه هنا وعلى بريدك.`,
          ...(photos.length ? [`أرفقت ${photos.length} صورة، وهذا يساعد الفريق كثيراً.`] : []),
        ],
        link: `${publicWebOrigin()}/ar/tenant/requests`,
        linkLabel: 'متابعة طلباتي',
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
    const people =
      row.type === 'report_staff'
        ? await staffReportRecipients(tx, orgId)
        : await ownerRecipients(tx, orgId, row.propertyId);
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
        tone: requestTone(row.type),
        details: [
          { label: 'رقم الطلب', value: row.reference },
          { label: 'المستأجر', value: tenant?.name ?? '—' },
        ],
        lines: [
          input.action === 'cancel'
            ? `سحب المستأجر ${tenant?.name ?? ''} طلبه (${typeLabel}).`
            : `أضاف المستأجر ${tenant?.name ?? ''} رداً على الطلب (${typeLabel}).`,
          ...(note ? [`«${note}»`] : []),
        ],
        link: `${publicWebOrigin()}/ar/owner/${row.type === 'maintenance' ? 'maintenance' : 'tenant-requests'}?focus=${row.id}`,
        linkLabel: row.type === 'maintenance' ? 'فتح بلاغات الصيانة' : 'فتح طلبات المستأجرين',
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
    ...(canSeeStaffReports(claims) ? [] : [ne(operationalRequests.type, 'report_staff')]),
  );
}

/** Requests tenants sent the organization, newest first; owner-scoped users see their own. */
export async function listOwnerTenantRequests(
  claims: SessionClaims,
  options: { type?: TenantRequestType } = {},
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
      .where(
        and(
          ownerScope(claims),
          ...(options.type ? [eq(operationalRequests.type, options.type)] : []),
        ),
      )
      .orderBy(desc(operationalRequests.createdAt))
      .limit(OWNER_LIST_LIMIT);
    const requests = rows.map((row) => tenantRequestFromRow(row, orgId));
    const statements = await leaseStatementsInTx(
      tx,
      orgId,
      requests.flatMap((request) =>
        request.leaseId && OPEN_TENANT_REQUEST.has(request.status) ? [request.leaseId] : [],
      ),
    );
    return rows.map((row, index) => {
      const request = requests[index]!;
      const arrears = request.leaseId
        ? statements.get(request.leaseId)?.statement.arrears.totalMinor
        : undefined;
      return {
        ...request,
        tenantName: row.tenantName,
        propertyId: row.propertyId,
        propertyNameAr: row.propertyNameAr,
        propertyNameEn: row.propertyNameEn,
        arrearsMinor: arrears && arrears !== '0' ? arrears : null,
      };
    });
  });
}

export type OwnerDecision =
  | 'approve'
  | 'reject'
  | 'in_progress'
  | 'on_hold'
  | 'complete'
  | 'reply'
  | 'emergency_confirm'
  | 'emergency_deny'
  | 'charge_paid';

const DECISION_STATUS: Record<
  Exclude<OwnerDecision, 'reply' | 'emergency_confirm' | 'emergency_deny' | 'charge_paid'>,
  TenantRequestStatus
> = {
  approve: 'approved',
  reject: 'rejected',
  in_progress: 'in_progress',
  on_hold: 'on_hold',
  complete: 'completed',
};

export type OwnerDecisionInput = {
  action: OwnerDecision;
  note?: string | undefined;
  date?: string | undefined;
  /** Approving maintenance at the tenant's cost: paid before the work, or later by `dueOn`. */
  charge?: { amountMinor: string; payment: ChargePayment; dueOn?: string | undefined } | undefined;
  method?: ChargePaymentMethod | undefined;
};

/**
 * The landlord answers a tenant request. Approving a cheque postponement moves the cheque to the
 * new date; approving a stop marks the cheque cancelled. Approving maintenance may bill the
 * tenant for it, before the work or later. Management confirms or denies an urgent request.
 * Either way the tenant is emailed.
 */
export async function decideTenantRequest(
  claims: SessionClaims,
  requestId: string,
  input: OwnerDecisionInput,
) {
  if (!canHandleTenantRequests(claims)) fail('forbidden');
  const note = input.note?.trim().slice(0, 1000) ?? '';
  if (
    (input.action === 'reject' || input.action === 'reply' || input.action === 'emergency_deny') &&
    !note
  ) {
    fail('tenant_request_invalid');
  }
  if (input.action === 'charge_paid' && !canRecordTenantPayments(claims)) fail('forbidden');
  if (input.charge) {
    if (input.action !== 'approve' || !/^\d{1,12}$/.test(input.charge.amountMinor)) {
      fail('tenant_charge_invalid');
    }
    if (input.charge.dueOn && !ISO_DATE.test(input.charge.dueOn)) fail('tenant_charge_invalid');
    if (BigInt(input.charge.amountMinor) <= 0n) fail('tenant_charge_invalid');
  }
  const orgId = claims.organizationId!;
  const policy = input.action === 'emergency_deny' ? await loadTenantPolicy(orgId) : null;
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
    if (!OPEN_TENANT_REQUEST.has(row.status) && input.action !== 'charge_paid') {
      fail('tenant_request_closed');
    }
    const data = meta(row.metadata);
    const request = tenantRequestFromRow(
      { ...row, unitCode: null, unitAr: null, unitEn: null },
      orgId,
    );
    if (
      input.action === 'complete' &&
      request.type === 'maintenance' &&
      closureProofMissing(request.media).length
    ) {
      fail('tenant_request_proof');
    }
    const now = new Date();
    let status: TenantRequestStatus =
      input.action === 'reply' ||
      input.action === 'emergency_confirm' ||
      input.action === 'emergency_deny' ||
      input.action === 'charge_paid'
        ? request.status
        : DECISION_STATUS[input.action];
    let effect: string | null = null;
    let priority = row.priority;

    if (input.action === 'emergency_confirm' || input.action === 'emergency_deny') {
      if (!request.emergency) fail('tenant_request_invalid');
      const confirmed = input.action === 'emergency_confirm';
      data.emergency = { ...request.emergency, verified: confirmed };
      if (confirmed) {
        effect = 'تحققت الإدارة من أن الحالة مستعجلة، وستُعالج بالأولوية.';
      } else {
        priority = 'normal';
        const blocked =
          request.leaseId &&
          row.requesterPartyId &&
          policy &&
          maintenanceBlockedByPolicy(policy, row.propertyId)
            ? (await leaseStatementsInTx(tx, orgId, [request.leaseId], row.requesterPartyId)).get(
                request.leaseId,
              )?.statement.arrears.totalMinor
            : null;
        if (blocked && blocked !== '0') {
          status = 'on_hold';
          effect =
            'لم تعتبر الإدارة الحالة مستعجلة؛ يُعامل كطلب صيانة عادي ويُستأنف بعد تسوية المبالغ المتأخرة عليك.';
        } else {
          effect = 'لم تعتبر الإدارة الحالة مستعجلة؛ يُعامل كطلب صيانة عادي.';
        }
      }
    }

    if (input.action === 'approve' && input.charge) {
      if (request.type !== 'maintenance' || request.charge || !request.leaseId) {
        fail('tenant_charge_invalid');
      }
      if (!row.requesterPartyId) fail('tenant_charge_invalid');
      const [lease] = await tx
        .select({ currency: leases.currency, tenantPartyId: leases.tenantPartyId })
        .from(leases)
        .where(and(eq(leases.id, request.leaseId), eq(leases.organizationId, orgId)))
        .limit(1);
      if (!lease) fail('tenant_request_not_found');
      const today = muscatToday();
      const dueOn = input.charge.payment === 'before_work' ? today : (input.charge.dueOn ?? today);
      const amount = BigInt(input.charge.amountMinor);
      const invoice = await insertChargeInvoice(tx, {
        orgId,
        actorUserId: claims.sub,
        leaseId: request.leaseId,
        tenantPartyId: lease.tenantPartyId,
        currency: lease.currency,
        category: 'maintenance',
        amountMinor: amount,
        dueOn,
        description: `تكلفة صيانة — ${row.subject}`.slice(0, 300),
        notes: `طلب المستأجر ${row.reference}`,
      });
      data.charge = {
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        amountMinor: amount.toString(),
        currency: lease.currency,
        payment: input.charge.payment,
        dueOn: invoice.dueOn,
        paidAt: null,
      };
      const money = formatMoney(amount.toString(), lease.currency, 'ar');
      if (input.charge.payment === 'before_work') {
        status = 'on_hold';
        effect = `تمت الموافقة على الصيانة بتكلفة ${money} على المستأجر (فاتورة ${invoice.number})، ويبدأ التنفيذ بعد سدادها.`;
      } else {
        effect = `تمت الموافقة على الصيانة بتكلفة ${money} على المستأجر (فاتورة ${invoice.number})، تُسدد حتى ${invoice.dueOn.split('-').reverse().join('/')}.`;
      }
    }

    if (input.action === 'charge_paid') {
      if (!request.charge || request.charge.paidAt) fail('tenant_charge_paid');
      const paid = await recordChargePayment(tx, {
        orgId,
        actorUserId: claims.sub,
        invoiceId: request.charge.invoiceId,
        method: input.method ?? 'cash',
      });
      data.charge = { ...meta(data.charge), paidAt: paid.paidAt };
      if (requestAwaitsPaymentRow(request.status, request.charge.payment)) status = 'approved';
      effect =
        status === 'approved' && request.status === 'on_hold'
          ? 'سُجّل سداد تكلفة الصيانة؛ يُستأنف تنفيذ الطلب.'
          : 'سُجّل سداد تكلفة الصيانة.';
    }

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
        priority,
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
          input.action === 'approve' && input.charge?.payment === 'before_work'
            ? 'وافقت إدارة العقار على طلب الصيانة، وعليك سداد تكلفتها قبل بدء التنفيذ.'
            : input.action === 'approve' && input.charge
              ? 'وافقت إدارة العقار على طلب الصيانة، وتُضاف تكلفتها إلى حسابك للسداد لاحقاً.'
              : input.action === 'emergency_confirm'
                ? 'تحققت الإدارة من طلبك المستعجل.'
                : input.action === 'emergency_deny'
                  ? 'راجعت الإدارة طلبك المستعجل.'
                  : status === row.status
                    ? 'أضاف المالك رداً على طلبك.'
                    : status === 'approved' || status === 'completed'
                      ? 'وافق المالك على طلبك.'
                      : status === 'rejected'
                        ? 'رفض المالك طلبك.'
                        : status === 'in_progress'
                          ? 'بدأ المالك تنفيذ طلبك.'
                          : 'علّق المالك طلبك مؤقتاً.';
        const fixed = status === 'completed' && request.type === 'maintenance';
        const resolver = fixed
          ? request.media.find((item) => item.stage === 'selfie' && item.by === 'team')?.name
          : null;
        await queueEmail(tx, {
          orgId,
          requestId: row.id,
          recipient: tenant.email,
          name: tenant.name,
          subject: fixed
            ? `✅ تم إصلاح المشكلة — طلبك ${row.reference}`
            : `تحديث على طلبك ${row.reference}: ${typeLabel}`,
          title: fixed ? 'تم الإصلاح! عاد كل شيء إلى مكانه' : 'هناك جديد على طلبك',
          tone: fixed ? 'maintenance' : requestTone(request.type),
          details: [
            { label: 'رقم المرجع', value: row.reference },
            { label: 'النوع', value: typeLabel },
            { label: 'الحالة', value: tenantRequestStatusLabel(status, true) },
            ...(resolver ? [{ label: 'أنجز العمل', value: resolver }] : []),
            ...(request.charge
              ? [
                  {
                    label: 'تكلفة الصيانة',
                    value: formatMoney(request.charge.amountMinor, request.charge.currency, 'ar'),
                  },
                ]
              : []),
          ],
          lines: [
            fixed
              ? 'أنهى فريق الصيانة العمل، وأرفق صورة بعد الإصلاح وصورة سيلفي لمن أنجزه؛ تجدها في صفحة طلباتك.'
              : verdict,
            ...(effect ? [effect] : []),
            ...(note ? [`ملاحظة الإدارة: «${note}»`] : []),
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

const DATA_URL = /^data:([^;,]+);base64,(.+)$/;

async function requestPhotoInTx(
  tx: Tx,
  orgId: string,
  metadata: unknown,
  index: number,
): Promise<string | null> {
  const eventId = meta(metadata).photosEventId;
  if (typeof eventId !== 'string') return null;
  return withElevatedRead(tx, async () => {
    const [event] = await tx
      .select({
        value: sql<string | null>`${workflowEvents.metadata}->'photos'->>${sql.raw(String(index))}`,
      })
      .from(workflowEvents)
      .where(and(eq(workflowEvents.id, eventId), eq(workflowEvents.organizationId, orgId)))
      .limit(1);
    return event?.value ?? null;
  });
}

/** One photo the tenant attached, for the tenant themselves or the landlord's people in scope. */
export async function readTenantRequestPhoto(
  claims: SessionClaims,
  requestId: string,
  index: number,
): Promise<{ mimeType: string; bytes: Buffer } | null> {
  if (!Number.isInteger(index) || index < 0 || index >= TENANT_REQUEST_PHOTOS_MAX) return null;
  const link = await findTenancyRequestLink(claims.sub, requestId);
  let dataUrl: string | null = null;
  if (link) {
    dataUrl = await withinTenancyLink(claims.sub, link, async (tx) => {
      const [row] = await tx
        .select({ metadata: operationalRequests.metadata })
        .from(operationalRequests)
        .where(
          and(
            eq(operationalRequests.id, requestId),
            eq(operationalRequests.organizationId, link.organizationId),
            eq(operationalRequests.requesterPartyId, link.partyId),
          ),
        )
        .limit(1);
      return row ? requestPhotoInTx(tx, link.organizationId, row.metadata, index) : null;
    });
  } else if (canHandleTenantRequests(claims)) {
    const orgId = claims.organizationId!;
    dataUrl = await withinViewerTenant(claims, async (tx) => {
      const [row] = await tx
        .select({ metadata: operationalRequests.metadata })
        .from(operationalRequests)
        .leftJoin(properties, eq(properties.id, operationalRequests.propertyId))
        .where(and(eq(operationalRequests.id, requestId), ownerScope(claims)))
        .limit(1);
      return row ? requestPhotoInTx(tx, orgId, row.metadata, index) : null;
    });
  }
  const parsed = dataUrl && REQUEST_IMAGE.test(dataUrl) ? DATA_URL.exec(dataUrl) : null;
  if (!parsed) return null;
  return { mimeType: parsed[1]!, bytes: Buffer.from(parsed[2]!, 'base64') };
}

type RequestRow = typeof operationalRequests.$inferSelect;
type MediaSide = 'tenant' | 'team';

/**
 * Runs `work` on one tenant request for whoever may see it: the tenant who sent it (in their own
 * session) or the landlord's people in scope. `side` limits who qualifies.
 */
async function onVisibleRequest<T>(
  claims: SessionClaims,
  requestId: string,
  side: MediaSide | 'either',
  work: (
    tx: Tx,
    row: RequestRow,
    viewer: { side: MediaSide; partyId: string | null },
  ) => Promise<T>,
  options: { lock?: boolean } = {},
): Promise<T | null> {
  const lock = options.lock ?? true;
  const link = side === 'team' ? null : await findTenancyRequestLink(claims.sub, requestId);
  if (link) {
    return withinTenancyLink(claims.sub, link, async (tx) => {
      const query = tx
        .select()
        .from(operationalRequests)
        .where(
          and(
            eq(operationalRequests.id, requestId),
            eq(operationalRequests.organizationId, link.organizationId),
            eq(operationalRequests.requesterPartyId, link.partyId),
            eq(operationalRequests.source, TENANT_REQUEST_SOURCE),
          ),
        );
      const [row] = await (lock ? query.for('update') : query).limit(1);
      return row ? work(tx, row, { side: 'tenant', partyId: link.partyId }) : null;
    });
  }
  if (side === 'tenant' || !canHandleTenantRequests(claims)) return null;
  return withinViewerTenant(claims, async (tx) => {
    const [found] = await tx
      .select({ id: operationalRequests.id })
      .from(operationalRequests)
      .leftJoin(properties, eq(properties.id, operationalRequests.propertyId))
      .where(and(eq(operationalRequests.id, requestId), ownerScope(claims)))
      .limit(1);
    if (!found) return null;
    const query = tx.select().from(operationalRequests).where(eq(operationalRequests.id, found.id));
    const [row] = await (lock ? query.for('update') : query).limit(1);
    return row ? work(tx, row, { side: 'team', partyId: null }) : null;
  });
}

type SniffedMedia = { kind: 'photo' | 'video'; mime: string; ext: string };

/** The real file type from its first bytes; the browser's Content-Type is never trusted. */
export function sniffRequestMedia(bytes: Buffer): SniffedMedia | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { kind: 'photo', mime: 'image/jpeg', ext: 'jpg' };
  }
  if (
    bytes.length >= 8 &&
    bytes.readUInt32BE(0) === 0x89504e47 &&
    bytes.readUInt32BE(4) === 0x0d0a1a0a
  ) {
    return { kind: 'photo', mime: 'image/png', ext: 'png' };
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { kind: 'photo', mime: 'image/webp', ext: 'webp' };
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp') {
    return bytes.toString('ascii', 8, 12) === 'qt  '
      ? { kind: 'video', mime: 'video/quicktime', ext: 'mov' }
      : { kind: 'video', mime: 'video/mp4', ext: 'mp4' };
  }
  if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3) {
    return { kind: 'video', mime: 'video/webm', ext: 'webm' };
  }
  return null;
}

/**
 * Adds a photo or a short video to a request. The tenant adds to what they reported; the
 * maintenance team adds photos or videos while working, and the closing proof: a photo of the
 * fixed problem and a selfie of whoever fixed it. Videos go to private object storage when it is
 * set up, otherwise they are kept with the request's history.
 */
export async function addTenantRequestMedia(
  claims: SessionClaims,
  requestId: string,
  input: { bytes: Buffer; stage: RequestMediaStage; side: MediaSide },
): Promise<{ id: string; kind: 'photo' | 'video' }> {
  const sniffed = sniffRequestMedia(input.bytes);
  if (!sniffed) fail('tenant_request_media');
  const limit = sniffed.kind === 'video' ? REQUEST_VIDEO_MAX_BYTES : REQUEST_PHOTO_UPLOAD_MAX_BYTES;
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > limit) fail('tenant_request_media');
  if ((input.side === 'tenant') !== (input.stage === 'report')) fail('tenant_request_media');
  if ((input.stage === 'after' || input.stage === 'selfie') && sniffed.kind !== 'photo') {
    fail('tenant_request_media');
  }
  if (input.side === 'team' && !canHandleTenantRequests(claims)) fail('forbidden');

  const mediaId = randomUUID();
  let stored: Record<string, unknown>;
  if (sniffed.kind === 'photo') {
    const branded = await brandUploadedPhoto(
      `data:${sniffed.mime};base64,${input.bytes.toString('base64')}`,
      HANDOVER_PHOTO_MAX,
    );
    const parsed = DATA_URL.exec(branded);
    if (!parsed || branded.length > HANDOVER_PHOTO_MAX * 2) fail('tenant_request_media');
    stored = { storage: 'inline', mime: parsed[1], data: parsed[2] };
  } else {
    stored = { storage: 'pending', mime: sniffed.mime };
  }

  const prepared = await onVisibleRequest(
    claims,
    requestId,
    input.side,
    async (_tx, row) => {
      if (!OPEN_TENANT_REQUEST.has(row.status)) fail('tenant_request_closed');
      const type = tenantRequestFromRow(
        { ...row, unitCode: null, unitAr: null, unitEn: null },
        row.organizationId,
      );
      if (input.side === 'tenant' ? !requestTakesPhotos(type.type) : type.type !== 'maintenance') {
        fail('tenant_request_invalid');
      }
      if (type.media.length >= REQUEST_MEDIA_MAX) fail('tenant_request_media');
      return { orgId: row.organizationId };
    },
    { lock: false },
  );
  if (!prepared) fail('tenant_request_not_found');

  if (sniffed.kind === 'video') {
    if (s3BucketsReady()) {
      const key = `org/${prepared.orgId}/requests/${requestId}/${mediaId}.${sniffed.ext}`;
      try {
        await putPrivateObject(key, input.bytes, sniffed.mime);
        stored = { storage: 's3', mime: sniffed.mime, key };
      } catch (error) {
        console.error('request video upload failed', error instanceof Error ? error.message : '');
        stored = { storage: 'inline', mime: sniffed.mime, data: input.bytes.toString('base64') };
      }
    } else {
      stored = { storage: 'inline', mime: sniffed.mime, data: input.bytes.toString('base64') };
    }
  }

  const result = await onVisibleRequest(claims, requestId, input.side, async (tx, row, viewer) => {
    if (!OPEN_TENANT_REQUEST.has(row.status)) fail('tenant_request_closed');
    const request = tenantRequestFromRow(
      { ...row, unitCode: null, unitAr: null, unitEn: null },
      row.organizationId,
    );
    if (request.media.length >= REQUEST_MEDIA_MAX) fail('tenant_request_media');
    const orgId = row.organizationId;
    let name: string | null;
    if (viewer.side === 'tenant' && viewer.partyId) {
      const [party] = await tx
        .select({ name: parties.displayName })
        .from(parties)
        .where(eq(parties.id, viewer.partyId))
        .limit(1);
      name = party?.name ?? null;
    } else {
      const [user] = await tx
        .select({ name: users.displayName })
        .from(users)
        .where(eq(users.id, claims.sub))
        .limit(1);
      name = user?.name ?? null;
    }
    const [event] = await tx
      .insert(workflowEvents)
      .values({
        organizationId: orgId,
        actorUserId: claims.sub,
        resourceType: 'operational_request',
        resourceId: row.id,
        eventType: 'tenant_request.media',
        metadata: {
          reference: row.reference,
          mediaId,
          kind: sniffed.kind,
          stage: input.stage,
          ...stored,
        },
      })
      .returning({ id: workflowEvents.id });
    const entry = {
      id: mediaId,
      eventId: event!.id,
      kind: sniffed.kind,
      stage: input.stage,
      by: viewer.side,
      name,
      at: new Date().toISOString(),
    };
    await tx
      .update(operationalRequests)
      .set({
        metadata: sql`jsonb_set(${operationalRequests.metadata}, '{media}', coalesce(${operationalRequests.metadata}->'media', '[]'::jsonb) || ${JSON.stringify([entry])}::jsonb)`,
        updatedAt: new Date(),
      })
      .where(eq(operationalRequests.id, row.id));

    if (viewer.side === 'tenant') {
      const people = await ownerRecipients(tx, orgId, row.propertyId);
      for (const person of people) {
        await queueEmail(tx, {
          orgId,
          requestId: row.id,
          recipient: person.email,
          name: person.name,
          subject: `${sniffed.kind === 'video' ? '🎬 مقطع فيديو جديد' : '📷 صورة جديدة'} على الطلب ${row.reference}`,
          title:
            sniffed.kind === 'video'
              ? 'أرسل المستأجر مقطع فيديو يوضّح المشكلة'
              : 'أرسل المستأجر صورة إضافية',
          tone: requestTone(row.type),
          details: [
            { label: 'رقم الطلب', value: row.reference },
            { label: 'المستأجر', value: name ?? '—' },
          ],
          lines: ['افتح الطلب لمشاهدته؛ الصورة تغني عن ألف رسالة، والفيديو عن ألف مكالمة 😉'],
          link: `${publicWebOrigin()}/ar/owner/${row.type === 'maintenance' ? 'maintenance' : 'tenant-requests'}?focus=${row.id}`,
          linkLabel: 'فتح الطلب',
        });
      }
    }
    return { id: mediaId, kind: sniffed.kind };
  });
  if (!result) fail('tenant_request_not_found');
  sendQueuedEmailsSoon();
  return result;
}

/** One photo or video added to a request, for the tenant who sent it or the landlord's people. */
export async function readTenantRequestMedia(
  claims: SessionClaims,
  requestId: string,
  mediaId: string,
): Promise<{ mimeType: string; bytes: Buffer } | null> {
  const found = await onVisibleRequest(
    claims,
    requestId,
    'either',
    async (tx, row) => {
      const entries = meta(row.metadata).media;
      const entry = Array.isArray(entries)
        ? (entries as Array<Record<string, unknown>>).find((item) => item?.id === mediaId)
        : undefined;
      const eventId = typeof entry?.eventId === 'string' ? entry.eventId : null;
      if (!eventId) return null;
      return withElevatedRead(tx, async () => {
        const [event] = await tx
          .select({ metadata: workflowEvents.metadata })
          .from(workflowEvents)
          .where(
            and(
              eq(workflowEvents.id, eventId),
              eq(workflowEvents.organizationId, row.organizationId),
              eq(workflowEvents.resourceId, row.id),
            ),
          )
          .limit(1);
        return event ? meta(event.metadata) : null;
      });
    },
    { lock: false },
  );
  if (!found || typeof found.mime !== 'string') return null;
  if (found.storage === 'inline' && typeof found.data === 'string') {
    return { mimeType: found.mime, bytes: Buffer.from(found.data, 'base64') };
  }
  if (found.storage === 's3' && typeof found.key === 'string') {
    const bytes = await readPrivateObject(found.key);
    return bytes ? { mimeType: found.mime, bytes } : null;
  }
  return null;
}
