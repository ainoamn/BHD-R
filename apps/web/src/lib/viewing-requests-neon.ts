import 'server-only';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import { parties, properties, units, users, viewingRequests } from '@bhd-r/db';
import { appLink, notifyByEmail } from '@/lib/email-notify';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';
import type { PendingApprovalItem } from '@/lib/pending-approvals-shared';
import { issueViewingPassToken, openViewingPassToken, randomViewingPin } from '@/lib/viewing-pass';
import type {
  ViewingGuestDecision,
  ViewingGuestPass,
  ViewingRequestDetail,
} from '@/lib/viewing-requests-shared';

export type { ViewingRequestDetail, ViewingGuestPass };

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.toISOString();
}

function fail(code: string): never {
  throw new Error(code);
}

function mapDetail(
  row: {
    id: string;
    reference: string;
    status: string;
    channel: string;
    notes: string | null;
    preferredAt: Date | null;
    scheduledAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    unitId: string;
    unitCode: string;
    propertyId: string;
    propertyNameAr: string;
    propertyNameEn: string | null;
    prospectPartyId: string;
    prospectName: string;
    prospectEmail: string | null;
    prospectPhone: string | null;
    accessUsername: string | null;
    accessPin: string | null;
    arrivedAt: Date | null;
    guestDecision: string | null;
    guestDecisionAt: Date | null;
    viewingContactUserId: string | null;
    viewingContactName: string | null;
  },
  canManage: boolean,
): ViewingRequestDetail {
  let token: string | null = null;
  if (row.accessUsername && row.accessPin && row.scheduledAt) {
    try {
      const until = Math.max(
        row.scheduledAt.getTime() + 36 * 60 * 60 * 1000,
        Date.now() + 7 * 24 * 60 * 60 * 1000,
      );
      token = issueViewingPassToken(row.id, new Date(until));
    } catch {
      token = null;
    }
  }
  const canSchedule = Boolean(row.viewingContactUserId);
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    channel: row.channel,
    notes: row.notes,
    preferredAt: iso(row.preferredAt),
    scheduledAt: iso(row.scheduledAt),
    completedAt: iso(row.completedAt),
    createdAt: iso(row.createdAt) ?? '',
    unitId: row.unitId,
    unitCode: row.unitCode,
    propertyId: row.propertyId,
    propertyNameAr: row.propertyNameAr,
    propertyNameEn: row.propertyNameEn,
    prospectPartyId: row.prospectPartyId,
    prospectName: row.prospectName,
    prospectEmail: row.prospectEmail,
    prospectPhone: row.prospectPhone,
    canManage,
    accessUsername: row.accessUsername,
    accessPin: row.accessPin,
    arrivedAt: iso(row.arrivedAt),
    guestDecision: (row.guestDecision as ViewingGuestDecision | null) ?? null,
    guestDecisionAt: iso(row.guestDecisionAt),
    passPath: token ? `/viewing-pass?t=${encodeURIComponent(token)}` : null,
    gatePath: token ? `/viewing-gate?t=${encodeURIComponent(token)}` : null,
    viewingContactUserId: row.viewingContactUserId,
    viewingContactName: row.viewingContactName,
    canSchedule,
  };
}

/** Email the property's managers when a guest submits a viewing request. */
export async function notifyOwnersOfViewingRequest(input: {
  viewingId: string;
  organizationId: string;
  unitId: string;
  reference: string;
}): Promise<void> {
  const { elevatedTx, rowsOf } = await import('@/lib/elevated-db');
  const { sql } = await import('drizzle-orm');
  try {
    const facts = await elevatedTx(async (tx) => {
      const rows = rowsOf<{
        property_id: string;
        property_name_ar: string;
        property_name_en: string | null;
        unit_code: string;
        prospect_name: string | null;
      }>(
        await tx.execute(sql`
          select p.id as property_id, p.name_ar as property_name_ar, p.name_en as property_name_en,
                 u.code as unit_code, pt.display_name as prospect_name
          from viewing_requests vr
          join units u on u.id = vr.unit_id
          join properties p on p.id = u.property_id
          left join parties pt on pt.id = vr.prospect_party_id
          where vr.id = ${input.viewingId}::uuid
          limit 1`),
      );
      return rows[0] ?? null;
    });
    if (!facts) return;
    await notifyByEmail({
      orgId: input.organizationId,
      aggregateType: 'viewing_request',
      aggregateId: input.viewingId,
      audience: {
        managersOf: { orgId: input.organizationId, propertyId: facts.property_id },
      },
      dedupeKey: `viewing-requested:${input.viewingId}`,
      content: () => ({
        tone: 'booking',
        subject: `طلب معاينة جديد — ${input.reference}`,
        title: 'طلب معاينة جديد',
        intro: facts.prospect_name
          ? `${facts.prospect_name} طلب معاينة الوحدة ${facts.unit_code} في ${facts.property_name_ar}.`
          : `وصل طلب معاينة للوحدة ${facts.unit_code} في ${facts.property_name_ar}.`,
        details: [
          { label: 'المرجع', value: input.reference },
          { label: 'العقار', value: facts.property_name_ar },
          { label: 'الوحدة', value: facts.unit_code },
        ],
        cta: {
          label: 'فتح طلب المعاينة',
          url: appLink(`/ar/owner/bookings/viewings/${input.viewingId}`),
        },
      }),
    });
  } catch (error) {
    console.error('viewing owner notify failed', error);
  }
}

/** Resolve a viewing by reference (+ unit) for owner notification after Nest create. */
export async function findViewingNotifyTarget(
  reference: string,
  unitId?: string | null,
): Promise<{
  viewingId: string;
  unitId: string;
  reference: string;
  organizationId: string;
} | null> {
  const { elevatedTx, rowsOf } = await import('@/lib/elevated-db');
  const { sql } = await import('drizzle-orm');
  return elevatedTx(async (tx) => {
    const rows = rowsOf<{
      id: string;
      unit_id: string;
      reference: string;
      organization_id: string;
    }>(
      await tx.execute(
        unitId
          ? sql`
        select id, unit_id, reference, organization_id from viewing_requests
        where reference = ${reference} and unit_id = ${unitId}::uuid
        order by created_at desc limit 1`
          : sql`
        select id, unit_id, reference, organization_id from viewing_requests
        where reference = ${reference}
        order by created_at desc limit 1`,
      ),
    );
    const row = rows[0];
    return row
      ? {
          viewingId: row.id,
          unitId: row.unit_id,
          reference: row.reference,
          organizationId: row.organization_id,
        }
      : null;
  });
}

export async function loadViewingRequestForStaff(
  claims: SessionClaims,
  viewingId: string,
): Promise<ViewingRequestDetail | null> {
  if (!hasPermission(claims, 'viewing.read')) fail('forbidden');
  if (!claims.organizationId) fail('forbidden');
  const ownerPartyId = ownerPartyScope(claims);

  return withinViewerTenant(claims, async (tx) => {
    const rows = await tx
      .select({
        id: viewingRequests.id,
        reference: viewingRequests.reference,
        status: viewingRequests.status,
        channel: viewingRequests.channel,
        notes: viewingRequests.notes,
        preferredAt: viewingRequests.preferredAt,
        scheduledAt: viewingRequests.scheduledAt,
        completedAt: viewingRequests.completedAt,
        createdAt: viewingRequests.createdAt,
        unitId: viewingRequests.unitId,
        unitCode: units.code,
        propertyId: properties.id,
        propertyNameAr: properties.nameAr,
        propertyNameEn: properties.nameEn,
        prospectPartyId: viewingRequests.prospectPartyId,
        prospectName: parties.displayName,
        prospectEmail: parties.email,
        prospectPhone: parties.phone,
        accessUsername: viewingRequests.accessUsername,
        accessPin: viewingRequests.accessPin,
        arrivedAt: viewingRequests.arrivedAt,
        guestDecision: viewingRequests.guestDecision,
        guestDecisionAt: viewingRequests.guestDecisionAt,
        viewingContactUserId: properties.viewingContactUserId,
        viewingContactName: users.displayName,
      })
      .from(viewingRequests)
      .innerJoin(units, eq(units.id, viewingRequests.unitId))
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .innerJoin(parties, eq(parties.id, viewingRequests.prospectPartyId))
      .leftJoin(users, eq(users.id, properties.viewingContactUserId))
      .where(
        and(
          eq(viewingRequests.id, viewingId),
          eq(viewingRequests.organizationId, claims.organizationId!),
          ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return mapDetail(row, hasPermission(claims, 'viewing.manage'));
  });
}

export type ViewingOwnerAction = {
  action: 'schedule' | 'complete' | 'cancel' | 'no_show' | 'reply';
  scheduledAt?: string | null;
  note?: string | null;
};

const OPEN_STATUSES = new Set(['requested', 'scheduled']);

export async function respondToViewingRequest(
  claims: SessionClaims,
  viewingId: string,
  input: ViewingOwnerAction,
): Promise<ViewingRequestDetail> {
  if (!hasPermission(claims, 'viewing.manage')) fail('forbidden');
  if (!claims.organizationId) fail('forbidden');

  const note = input.note?.trim().slice(0, 4000) || null;
  let scheduledAt: Date | null = null;
  if (input.action === 'schedule') {
    if (!input.scheduledAt) fail('viewing_schedule_required');
    const parsed = new Date(input.scheduledAt);
    if (Number.isNaN(parsed.getTime())) fail('viewing_schedule_invalid');
    scheduledAt = parsed;
  }

  const nextStatus =
    input.action === 'schedule'
      ? 'scheduled'
      : input.action === 'complete'
        ? 'completed'
        : input.action === 'cancel'
          ? 'cancelled'
          : input.action === 'no_show'
            ? 'no_show'
            : null;

  type IssuedPass = {
    username: string;
    pin: string;
    token: string;
    when: string;
    propertyId: string;
    propertyNameAr: string;
    unitCode: string;
    prospectName: string;
    prospectPartyId: string;
    organizationId: string;
    reference: string;
    contactUserId: string;
    contactName: string | null;
  };
  // Holder avoids TS treating assignments inside the async callback as unreachable.
  const issued: { pass: IssuedPass | null } = { pass: null };

  await withinViewerTenant(claims, async (tx) => {
    const ownerPartyId = ownerPartyScope(claims);
    const current = await tx
      .select({
        id: viewingRequests.id,
        status: viewingRequests.status,
        notes: viewingRequests.notes,
        prospectPartyId: viewingRequests.prospectPartyId,
        reference: viewingRequests.reference,
        unitId: viewingRequests.unitId,
        propertyId: properties.id,
        propertyNameAr: properties.nameAr,
        unitCode: units.code,
        organizationId: viewingRequests.organizationId,
        prospectName: parties.displayName,
        accessUsername: viewingRequests.accessUsername,
        accessPin: viewingRequests.accessPin,
        viewingContactUserId: properties.viewingContactUserId,
        viewingContactName: users.displayName,
      })
      .from(viewingRequests)
      .innerJoin(units, eq(units.id, viewingRequests.unitId))
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .innerJoin(parties, eq(parties.id, viewingRequests.prospectPartyId))
      .leftJoin(users, eq(users.id, properties.viewingContactUserId))
      .where(
        and(
          eq(viewingRequests.id, viewingId),
          eq(viewingRequests.organizationId, claims.organizationId!),
          ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
        ),
      )
      .limit(1);
    const row = current[0];
    if (!row) fail('not_found');
    if (input.action === 'reply') {
      if (!note) fail('viewing_note_required');
      const merged = row.notes ? `${row.notes}\n\n—\n${note}` : note;
      await tx
        .update(viewingRequests)
        .set({ notes: merged, updatedAt: new Date() })
        .where(eq(viewingRequests.id, viewingId));
      return;
    }
    if (!OPEN_STATUSES.has(row.status) && input.action === 'schedule') fail('viewing_closed');
    if (!nextStatus) fail('viewing_action_invalid');

    if (input.action === 'schedule') {
      if (!scheduledAt) fail('viewing_schedule_required');
      if (!row.viewingContactUserId) fail('viewing_contact_required');
    }

    const mergedNotes = note
      ? row.notes
        ? `${row.notes}\n\n—\n${note}`
        : note
      : row.notes;

    const username = row.accessUsername ?? row.reference;
    const pin = row.accessPin ?? randomViewingPin();
    const passExpires = scheduledAt
      ? new Date(scheduledAt.getTime() + 36 * 60 * 60 * 1000)
      : null;
    const token =
      input.action === 'schedule' && scheduledAt && passExpires
        ? issueViewingPassToken(viewingId, passExpires)
        : null;

    await tx
      .update(viewingRequests)
      .set({
        status: nextStatus as typeof row.status,
        ...(scheduledAt ? { scheduledAt } : {}),
        ...(mergedNotes !== row.notes ? { notes: mergedNotes } : {}),
        ...(input.action === 'schedule' && row.viewingContactUserId
          ? {
              accessUsername: username,
              accessPin: pin,
              assignedToUserId: row.viewingContactUserId,
            }
          : {}),
        ...(nextStatus === 'completed' || nextStatus === 'cancelled' || nextStatus === 'no_show'
          ? { completedAt: new Date() }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(viewingRequests.id, viewingId));

    if (input.action === 'schedule' && scheduledAt && token && row.viewingContactUserId) {
      issued.pass = {
        username,
        pin,
        token,
        when: scheduledAt.toISOString(),
        propertyId: row.propertyId,
        propertyNameAr: row.propertyNameAr,
        unitCode: row.unitCode,
        prospectName: row.prospectName,
        prospectPartyId: row.prospectPartyId,
        organizationId: row.organizationId,
        reference: row.reference,
        contactUserId: row.viewingContactUserId,
        contactName: row.viewingContactName,
      };
    }
  });

  if (issued.pass) {
    const pass = issued.pass;
    const passUrl = appLink(`/ar/viewing-pass?t=${encodeURIComponent(pass.token)}`);
    const gateUrl = appLink(`/ar/viewing-gate?t=${encodeURIComponent(pass.token)}`);
    const whenLabel = pass.when.slice(0, 16).replace('T', ' ');

    void notifyByEmail({
      orgId: pass.organizationId,
      aggregateType: 'viewing_request',
      aggregateId: viewingId,
      audience: { parties: [pass.prospectPartyId] },
      dedupeKey: `viewing-scheduled:${viewingId}:${pass.when}`,
      content: () => ({
        tone: 'booking',
        subject: `موافقة المعاينة — ${pass.reference}`,
        title: 'تمت الموافقة على موعد المعاينة',
        intro: `وافق المالك على معاينة الوحدة ${pass.unitCode} في ${pass.propertyNameAr}. احفظ بطاقة الزيارة وبيانات الدخول أدناه واعرضها عند الوصول.`,
        details: [
          { label: 'المرجع', value: pass.reference },
          { label: 'الموعد', value: whenLabel },
          { label: 'اسم المستخدم', value: pass.username },
          { label: 'الرقم السري', value: pass.pin },
          ...(pass.contactName
            ? [{ label: 'مسؤول الاستقبال', value: pass.contactName }]
            : []),
          ...(note ? [{ label: 'ملاحظة', value: note }] : []),
        ],
        cta: { label: 'بطاقة المعاينة والباركود', url: passUrl },
      }),
    }).catch(() => undefined);

    void notifyByEmail({
      orgId: pass.organizationId,
      aggregateType: 'viewing_request',
      aggregateId: viewingId,
      audience: {
        users: [pass.contactUserId],
        managersOf: { orgId: pass.organizationId, propertyId: pass.propertyId },
      },
      dedupeKey: `viewing-guard:${viewingId}:${pass.when}`,
      content: () => ({
        tone: 'booking',
        subject: `زيارة معاينة قادمة — ${pass.reference}`,
        title: 'عميل سيزور المبنى للمعاينة',
        intro: `${pass.prospectName} سيزور الوحدة ${pass.unitCode} في ${pass.propertyNameAr}. عند وصوله امسح باركود بطاقة المعاينة لتوثيق الحضور.`,
        details: [
          { label: 'المرجع', value: pass.reference },
          { label: 'الزائر', value: pass.prospectName },
          { label: 'الموعد', value: whenLabel },
          { label: 'اسم المستخدم', value: pass.username },
          { label: 'الرقم السري', value: pass.pin },
        ],
        cta: { label: 'مسح بطاقة المعاينة', url: gateUrl },
      }),
    }).catch(() => undefined);
  }

  const detail = await loadViewingRequestForStaff(claims, viewingId);
  if (!detail) fail('not_found');
  return detail;
}

/** Pending viewing requests for the owner bell and home alerts. */
export async function viewingRequestApprovalItems(
  claims: SessionClaims,
): Promise<PendingApprovalItem[]> {
  if (!hasPermission(claims, 'viewing.read') || !claims.organizationId) return [];
  const ownerPartyId = ownerPartyScope(claims);
  return withinViewerTenant(claims, async (tx) => {
    const rows = await tx
      .select({
        id: viewingRequests.id,
        reference: viewingRequests.reference,
        propertyId: properties.id,
        propertyNameAr: properties.nameAr,
        propertyNameEn: properties.nameEn,
        unitCode: units.code,
        party: parties.displayName,
        requestedAt: viewingRequests.createdAt,
      })
      .from(viewingRequests)
      .innerJoin(units, eq(units.id, viewingRequests.unitId))
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .leftJoin(parties, eq(parties.id, viewingRequests.prospectPartyId))
      .where(
        and(
          eq(viewingRequests.organizationId, claims.organizationId!),
          inArray(viewingRequests.status, ['requested']),
          ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
        ),
      )
      .orderBy(asc(viewingRequests.createdAt))
      .limit(50);
    return rows.map((row) => ({
      kind: 'viewing_request' as const,
      id: row.id,
      reference: row.reference,
      propertyId: row.propertyId,
      propertyNameAr: row.propertyNameAr,
      propertyNameEn: row.propertyNameEn,
      unitCode: row.unitCode,
      party: row.party,
      contractType: null,
      fromOn: null,
      requestedAt: iso(row.requestedAt) ?? '',
    }));
  });
}

/** Public guest pass from a sealed QR token (no login). */
export async function loadViewingGuestPass(token: string): Promise<ViewingGuestPass | null> {
  const viewingId = openViewingPassToken(token);
  if (!viewingId) return null;
  const { elevatedTx } = await import('@/lib/elevated-db');
  return elevatedTx(async (tx) => {
    const rows = await tx
      .select({
        id: viewingRequests.id,
        reference: viewingRequests.reference,
        status: viewingRequests.status,
        scheduledAt: viewingRequests.scheduledAt,
        arrivedAt: viewingRequests.arrivedAt,
        accessUsername: viewingRequests.accessUsername,
        accessPin: viewingRequests.accessPin,
        propertyNameAr: properties.nameAr,
        propertyNameEn: properties.nameEn,
        unitCode: units.code,
        unitId: units.id,
        propertyId: properties.id,
        prospectName: parties.displayName,
        guestDecision: viewingRequests.guestDecision,
        listingPurpose: units.listingPurpose,
      })
      .from(viewingRequests)
      .innerJoin(units, eq(units.id, viewingRequests.unitId))
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .innerJoin(parties, eq(parties.id, viewingRequests.prospectPartyId))
      .where(eq(viewingRequests.id, viewingId))
      .limit(1);
    const row = rows[0];
    if (!row?.accessUsername || !row.accessPin) return null;
    if (row.status !== 'scheduled' && row.status !== 'completed') return null;
    const purpose =
      row.listingPurpose === 'sale' || row.listingPurpose === 'both' || row.listingPurpose === 'rent'
        ? row.listingPurpose
        : 'rent';
    return {
      id: row.id,
      reference: row.reference,
      status: row.status,
      scheduledAt: iso(row.scheduledAt),
      arrivedAt: iso(row.arrivedAt),
      accessUsername: row.accessUsername,
      accessPin: row.accessPin,
      propertyNameAr: row.propertyNameAr,
      propertyNameEn: row.propertyNameEn,
      unitCode: row.unitCode,
      unitId: row.unitId,
      propertyId: row.propertyId,
      prospectName: row.prospectName,
      guestDecision: (row.guestDecision as ViewingGuestDecision | null) ?? null,
      token,
      listingPurpose: purpose,
    };
  });
}

/** Staff/guard check-in: scan token or type username+PIN → mark arrived. */
export async function checkInViewingVisit(
  claims: SessionClaims,
  input: { token?: string | null; username?: string | null; pin?: string | null },
): Promise<{
  ok: true;
  alreadyArrived: boolean;
  arrivedAt: string;
  reference: string;
  prospectName: string;
  unitCode: string;
  propertyNameAr: string;
  scheduledAt: string | null;
}> {
  if (!hasPermission(claims, 'viewing.checkin')) fail('forbidden');
  if (!claims.organizationId) fail('forbidden');

  let viewingId: string | null = null;
  if (input.token) {
    viewingId = openViewingPassToken(input.token);
    if (!viewingId) fail('viewing_pass_invalid');
  }

  const ownerPartyId = ownerPartyScope(claims);
  return withinViewerTenant(claims, async (tx) => {
    const rows = await tx
      .select({
        id: viewingRequests.id,
        reference: viewingRequests.reference,
        status: viewingRequests.status,
        scheduledAt: viewingRequests.scheduledAt,
        arrivedAt: viewingRequests.arrivedAt,
        accessUsername: viewingRequests.accessUsername,
        accessPin: viewingRequests.accessPin,
        prospectName: parties.displayName,
        unitCode: units.code,
        propertyNameAr: properties.nameAr,
      })
      .from(viewingRequests)
      .innerJoin(units, eq(units.id, viewingRequests.unitId))
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .innerJoin(parties, eq(parties.id, viewingRequests.prospectPartyId))
      .where(
        and(
          eq(viewingRequests.organizationId, claims.organizationId!),
          ...(viewingId
            ? [eq(viewingRequests.id, viewingId)]
            : [
                eq(viewingRequests.accessUsername, (input.username ?? '').trim()),
                eq(viewingRequests.accessPin, (input.pin ?? '').trim()),
              ]),
          ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) fail('not_found');
    if (row.status !== 'scheduled' && row.status !== 'completed') fail('viewing_closed');
    if (row.arrivedAt) {
      return {
        ok: true as const,
        alreadyArrived: true,
        arrivedAt: iso(row.arrivedAt)!,
        reference: row.reference,
        prospectName: row.prospectName,
        unitCode: row.unitCode,
        propertyNameAr: row.propertyNameAr,
        scheduledAt: iso(row.scheduledAt),
      };
    }
    const now = new Date();
    await tx
      .update(viewingRequests)
      .set({ arrivedAt: now, updatedAt: now })
      .where(eq(viewingRequests.id, row.id));
    return {
      ok: true as const,
      alreadyArrived: false,
      arrivedAt: now.toISOString(),
      reference: row.reference,
      prospectName: row.prospectName,
      unitCode: row.unitCode,
      propertyNameAr: row.propertyNameAr,
      scheduledAt: iso(row.scheduledAt),
    };
  });
}

/** Guest records post-visit decision (book rent/sale or decline). */
export async function recordViewingGuestDecision(
  token: string,
  decision: ViewingGuestDecision,
): Promise<ViewingGuestPass> {
  const viewingId = openViewingPassToken(token);
  if (!viewingId) fail('viewing_pass_invalid');
  const { elevatedTx } = await import('@/lib/elevated-db');
  await elevatedTx(async (tx) => {
    const rows = await tx
      .select({
        id: viewingRequests.id,
        status: viewingRequests.status,
        guestDecision: viewingRequests.guestDecision,
        arrivedAt: viewingRequests.arrivedAt,
        scheduledAt: viewingRequests.scheduledAt,
      })
      .from(viewingRequests)
      .where(eq(viewingRequests.id, viewingId))
      .limit(1);
    const row = rows[0];
    if (!row) fail('not_found');
    if (row.status !== 'scheduled' && row.status !== 'completed') fail('viewing_closed');
    if (row.guestDecision) fail('viewing_decision_locked');
    const now = new Date();
    await tx
      .update(viewingRequests)
      .set({
        guestDecision: decision,
        guestDecisionAt: now,
        ...(row.status === 'scheduled' ? { status: 'completed', completedAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(viewingRequests.id, viewingId));
  });
  const pass = await loadViewingGuestPass(token);
  if (!pass) fail('not_found');
  return pass;
}
