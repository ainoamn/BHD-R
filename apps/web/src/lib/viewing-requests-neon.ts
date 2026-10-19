import 'server-only';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import { parties, properties, units, viewingRequests } from '@bhd-r/db';
import { appLink, notifyByEmail } from '@/lib/email-notify';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';
import type { PendingApprovalItem } from '@/lib/pending-approvals-shared';
import type { ViewingRequestDetail } from '@/lib/viewing-requests-shared';

export type { ViewingRequestDetail };

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.toISOString();
}

function fail(code: string): never {
  throw new Error(code);
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
        ownerPartyId: properties.ownerPartyId,
      })
      .from(viewingRequests)
      .innerJoin(units, eq(units.id, viewingRequests.unitId))
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .innerJoin(parties, eq(parties.id, viewingRequests.prospectPartyId))
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
      canManage: hasPermission(claims, 'viewing.manage'),
    };
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
        propertyNameAr: properties.nameAr,
        unitCode: units.code,
        organizationId: viewingRequests.organizationId,
      })
      .from(viewingRequests)
      .innerJoin(units, eq(units.id, viewingRequests.unitId))
      .innerJoin(properties, eq(properties.id, units.propertyId))
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

    const mergedNotes = note
      ? row.notes
        ? `${row.notes}\n\n—\n${note}`
        : note
      : row.notes;

    await tx
      .update(viewingRequests)
      .set({
        status: nextStatus as typeof row.status,
        ...(scheduledAt ? { scheduledAt } : {}),
        ...(mergedNotes !== row.notes ? { notes: mergedNotes } : {}),
        ...(nextStatus === 'completed' || nextStatus === 'cancelled' || nextStatus === 'no_show'
          ? { completedAt: new Date() }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(viewingRequests.id, viewingId));

    if (input.action === 'schedule' && scheduledAt) {
      const when = scheduledAt.toISOString();
      void notifyByEmail({
        orgId: row.organizationId,
        aggregateType: 'viewing_request',
        aggregateId: viewingId,
        audience: { parties: [row.prospectPartyId] },
        dedupeKey: `viewing-scheduled:${viewingId}:${when}`,
        content: () => ({
          tone: 'booking',
          subject: `موعد المعاينة — ${row.reference}`,
          title: 'تم تحديد موعد المعاينة',
          intro: `حدّد المالك موعد معاينة للوحدة ${row.unitCode} في ${row.propertyNameAr}.`,
          details: [
            { label: 'المرجع', value: row.reference },
            { label: 'الموعد', value: when },
            ...(note ? [{ label: 'ملاحظة', value: note }] : []),
          ],
          cta: {
            label: 'تفاصيل الوحدة',
            url: appLink(`/ar/units/${row.unitId}`),
          },
        }),
      }).catch(() => undefined);
    }
  });

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
