import 'server-only';
import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  billingSchedules,
  contractSignatures,
  contractTemplates,
  contracts,
  leases,
  stayBookings,
  stayProfiles,
  workflowEvents,
  type Database,
} from '@bhd-r/db';
import { allocateChildContractReference } from '@/lib/contract-reference-neon';
import { DEFAULT_CONTRACT_TEMPLATES } from '@/lib/contract-default-templates';
import { readStayTypeFromSnapshot } from '@/lib/stay-booking-dates';
import { computeStayLateReturn, type StayLateReturn } from '@/lib/stay-late-return';
import type { StayPeriodType } from '@/lib/stay-period-times';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as T[];
}

function contractSignatureHash(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

async function ensureStayTerminationTemplate(transaction: Tx, orgId: string): Promise<string> {
  const key = 'stay_termination_addendum';
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${orgId}:${key}:ar`}, 11))`,
  );
  const [existing] = await transaction
    .select({ id: contractTemplates.id })
    .from(contractTemplates)
    .where(
      and(
        eq(contractTemplates.organizationId, orgId),
        eq(contractTemplates.key, key),
        eq(contractTemplates.language, 'ar'),
        eq(contractTemplates.active, true),
      ),
    )
    .limit(1);
  if (existing) return existing.id;
  const html = DEFAULT_CONTRACT_TEMPLATES.stay_termination_addendum.ar;
  const [versionRow] = rowsOf<{ version: number }>(
    await transaction.execute(sql`
      select coalesce(max(version), 0)::integer + 1 as version
      from contract_templates
      where organization_id = ${orgId} and key = ${key} and language = 'ar'
    `),
  );
  const [created] = await transaction
    .insert(contractTemplates)
    .values({
      organizationId: orgId,
      key,
      version: Number(versionRow?.version ?? 1),
      language: 'ar',
      html,
      contentHash: createHash('sha256').update(html).digest('hex'),
      active: true,
    })
    .returning({ id: contractTemplates.id });
  return created!.id;
}

export type StayCheckoutCloseResult = {
  leaseId: string | null;
  terminationId: string | null;
  terminationReference: string | null;
  lateReturn: StayLateReturn | null;
  repaired: boolean;
};

/**
 * After a stay check-out: end the linked lease, issue a signed termination addendum
 * (ملحق إلغاء العقد), and compute any late return for the deposit decision.
 * Idempotent — safe to call again for already-closed stays.
 */
export async function closeStayContractAfterCheckoutInTx(
  tx: Tx,
  input: {
    organizationId: string;
    bookingId: string;
    actorUserId: string | null;
    /** Actual check-out instant; defaults to now. */
    checkedOutAt?: Date | string | null;
    recordedBy?: string | null;
  },
): Promise<StayCheckoutCloseResult> {
  const orgId = input.organizationId;
  const now = new Date();
  const checkedOutAt = input.checkedOutAt
    ? typeof input.checkedOutAt === 'string'
      ? new Date(input.checkedOutAt)
      : input.checkedOutAt
    : now;
  const checkedOutIso = Number.isNaN(checkedOutAt.getTime())
    ? now.toISOString()
    : checkedOutAt.toISOString();
  const effectiveOn = checkedOutIso.slice(0, 10);

  const [booking] = await tx
    .select({
      id: stayBookings.id,
      organizationId: stayBookings.organizationId,
      referenceCode: stayBookings.referenceCode,
      status: stayBookings.status,
      checkInOn: stayBookings.checkInOn,
      checkOutOn: stayBookings.checkOutOn,
      currency: stayBookings.currency,
      totalMinor: stayBookings.totalMinor,
      stayProfileId: stayBookings.stayProfileId,
      pricingSnapshotJson: stayBookings.pricingSnapshotJson,
      unitId: stayBookings.unitId,
      guestPartyId: stayBookings.guestPartyId,
    })
    .from(stayBookings)
    .where(and(eq(stayBookings.id, input.bookingId), eq(stayBookings.organizationId, orgId)))
    .limit(1);
  // `closed` is the settled post-checkout status; treat it like checked_out for annex + lease close.
  if (!booking || (booking.status !== 'checked_out' && booking.status !== 'closed')) {
    return {
      leaseId: null,
      terminationId: null,
      terminationReference: null,
      lateReturn: null,
      repaired: false,
    };
  }

  const [parent] = await tx
    .select({
      id: contracts.id,
      reference: contracts.reference,
      payloadSnapshot: contracts.payloadSnapshot,
      ownerPartyId: contracts.ownerPartyId,
      tenantPartyId: contracts.tenantPartyId,
      unitId: contracts.unitId,
      status: contracts.status,
    })
    .from(contracts)
    .where(
      and(
        eq(contracts.organizationId, orgId),
        sql`${contracts.payloadSnapshot}->'source'->>'stayBookingId' = ${booking.id}`,
        ne(contracts.status, 'void'),
        isNull(contracts.parentContractId),
      ),
    )
    .limit(1);
  if (!parent) {
    return {
      leaseId: null,
      terminationId: null,
      terminationReference: null,
      lateReturn: null,
      repaired: false,
    };
  }

  const [profileTimes] = booking.stayProfileId
    ? await tx
        .select({
          checkInFrom: stayProfiles.checkInFrom,
          dayUseCheckInFrom: stayProfiles.dayUseCheckInFrom,
          dayUseCheckOutUntil: stayProfiles.dayUseCheckOutUntil,
          overnightCheckOutUntil: stayProfiles.overnightCheckOutUntil,
          checkOutUntil: stayProfiles.checkOutUntil,
        })
        .from(stayProfiles)
        .where(
          and(eq(stayProfiles.id, booking.stayProfileId), eq(stayProfiles.organizationId, orgId)),
        )
        .limit(1)
    : [null];
  const stayType =
    readStayTypeFromSnapshot(booking.pricingSnapshotJson) ??
    ((parent.payloadSnapshot as Record<string, unknown> | null)?.stayType as string | null) ??
    null;
  const lateReturn = computeStayLateReturn({
    checkInOn: booking.checkInOn,
    checkOutOn: booking.checkOutOn,
    stayType,
    profile: profileTimes ?? {},
    actualAt: checkedOutIso,
  });

  const [existingTerm] = await tx
    .select({ id: contracts.id, reference: contracts.reference })
    .from(contracts)
    .where(
      and(
        eq(contracts.organizationId, orgId),
        eq(contracts.parentContractId, parent.id),
        eq(contracts.kind, 'termination'),
        sql`${contracts.payloadSnapshot}->'source'->>'stayBookingId' = ${booking.id}`,
      ),
    )
    .limit(1);

  const [lease] = await tx
    .select({
      id: leases.id,
      status: leases.status,
      startsOn: leases.startsOn,
      endsOn: leases.endsOn,
    })
    .from(leases)
    .where(and(eq(leases.organizationId, orgId), eq(leases.contractId, parent.id)))
    .limit(1);

  let repaired = false;
  if (
    lease &&
    (lease.status === 'active' ||
      lease.status === 'cancel_requested' ||
      lease.status === 'clearance_pending')
  ) {
    const clearanceNote =
      lateReturn.lateMinutes > 0
        ? `إغلاق تلقائي بعد مغادرة الإقامة ${booking.referenceCode}. تأخير التسليم: ${lateReturn.labelAr}. قرار الخصم من التأمين للمالك.`
        : `إغلاق تلقائي بعد مغادرة الإقامة ${booking.referenceCode}.`;
    // Keep endsOn after startsOn (day-use leases often start and end on the same civil day).
    const endsOn =
      effectiveOn > lease.startsOn.slice(0, 10) ? effectiveOn : lease.endsOn.slice(0, 10);
    await tx
      .update(leases)
      .set({
        status: 'cancelled',
        exitKind: 'cancel',
        cancellationSource: 'admin',
        cancellationProposedOn: effectiveOn,
        cancellationEffectiveOn: effectiveOn,
        cancellationRequestedAt: checkedOutAt,
        cancellationRequestedByUserId: input.actorUserId,
        cancellationAdminApprovedAt: checkedOutAt,
        cancellationAdminApprovedByUserId: input.actorUserId,
        cancellationClearedAt: checkedOutAt,
        cancellationClearedByUserId: input.actorUserId,
        cancellationClearanceNote: clearanceNote,
        endsOn,
        updatedAt: now,
      })
      .where(eq(leases.id, lease.id));
    await tx
      .update(billingSchedules)
      .set({ status: 'cancelled', updatedAt: now })
      .where(eq(billingSchedules.leaseId, lease.id));
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: input.actorUserId,
      resourceType: 'lease',
      resourceId: lease.id,
      eventType: 'lease.cancelled',
      fromStatus: lease.status,
      toStatus: 'cancelled',
      metadata: {
        source: 'stay_checkout',
        stayBookingId: booking.id,
        referenceCode: booking.referenceCode,
        checkedOutAt: checkedOutIso,
        lateReturn,
        terminationContractId: existingTerm?.id ?? null,
      },
    });
    repaired = true;
  }

  const snapshot =
    parent.payloadSnapshot && typeof parent.payloadSnapshot === 'object'
      ? { ...(parent.payloadSnapshot as Record<string, unknown>) }
      : {};

  if (existingTerm) {
    const priorSync =
      snapshot.terminationSync && typeof snapshot.terminationSync === 'object'
        ? (snapshot.terminationSync as Record<string, unknown>)
        : null;
    const alreadyClosed =
      (parent.status === 'terminated' || parent.status === 'void') &&
      priorSync?.terminationContractId === existingTerm.id;
    // Idempotent: never rewrite payload/updatedAt on every contract-detail open —
    // that bumps live_changes and LiveSync refreshes the page in a flicker loop.
    if (!alreadyClosed) {
      await tx
        .update(contracts)
        .set({
          status: parent.status === 'void' ? parent.status : 'terminated',
          payloadSnapshot: {
            ...snapshot,
            stayType: stayType as StayPeriodType | null,
            terminationSync: {
              at: checkedOutIso,
              terminationContractId: existingTerm.id,
              terminationReference: existingTerm.reference,
              lateReturn,
              cancelledAt: checkedOutIso,
              effectiveOn,
            },
          },
          updatedAt: now,
        })
        .where(and(eq(contracts.id, parent.id), eq(contracts.organizationId, orgId)));
      repaired = true;
    }
    return {
      leaseId: lease?.id ?? null,
      terminationId: existingTerm.id,
      terminationReference: existingTerm.reference,
      lateReturn,
      repaired,
    };
  }

  const templateId = await ensureStayTerminationTemplate(tx, orgId);
  const parentReference = parent.reference ?? `CTR-${parent.id.slice(0, 8).toUpperCase()}`;
  const reference = await allocateChildContractReference(
    tx,
    orgId,
    parent.id,
    parentReference,
  );
  const owner = snapshot.owner && typeof snapshot.owner === 'object' ? snapshot.owner : null;
  const tenant =
    (snapshot.tenant && typeof snapshot.tenant === 'object' ? snapshot.tenant : null) ??
    (snapshot.buyer && typeof snapshot.buyer === 'object' ? snapshot.buyer : null);
  const property =
    snapshot.property && typeof snapshot.property === 'object' ? snapshot.property : null;
  const unit = snapshot.unit && typeof snapshot.unit === 'object' ? snapshot.unit : null;
  const priorAmount =
    snapshot.amount && typeof snapshot.amount === 'object'
      ? (snapshot.amount as Record<string, unknown>)
      : {};
  const currency =
    typeof priorAmount.currency === 'string' ? priorAmount.currency : booking.currency;

  const [termination] = await tx
    .insert(contracts)
    .values({
      organizationId: orgId,
      reference,
      kind: 'termination',
      parentContractId: parent.id,
      templateVersionId: templateId,
      unitId: parent.unitId,
      ownerPartyId: parent.ownerPartyId,
      tenantPartyId: parent.tenantPartyId,
      status: 'signed',
      sentAt: now,
      completedAt: now,
      payloadSnapshot: {
        contract: {
          reference,
          type: 'lease',
          kind: 'termination',
          parentReference,
        },
        source: {
          type: 'stay_booking_checkout',
          stayBookingId: booking.id,
          referenceCode: booking.referenceCode,
        },
        owner: owner ?? { id: parent.ownerPartyId },
        tenant: tenant ?? { id: parent.tenantPartyId },
        property,
        unit: unit ?? { id: parent.unitId },
        startsOn: booking.checkInOn.slice(0, 10),
        endsOn: effectiveOn,
        stayType,
        checkInTime: snapshot.checkInTime ?? null,
        checkOutTime: snapshot.checkOutTime ?? null,
        amount: {
          amountMinor:
            typeof priorAmount.amountMinor === 'string'
              ? priorAmount.amountMinor
              : booking.totalMinor.toString(),
          currency,
        },
        termination: {
          cancelledAt: checkedOutIso,
          effectiveOn,
          reason: 'stay_checked_out',
          recordedBy: input.recordedBy ?? null,
          lateReturn,
        },
        approval: {
          mode: 'system_on_checkout',
          at: checkedOutIso,
        },
      },
    })
    .returning({ id: contracts.id });

  if (termination) {
    await tx
      .insert(contractSignatures)
      .values([
        {
          organizationId: orgId,
          contractId: termination.id,
          signerPartyId: parent.tenantPartyId,
          signerRole: 'tenant',
          method: 'system_on_checkout',
          evidence: {
            bookingReference: booking.referenceCode,
            kind: 'stay_checkout_termination',
            checkedOutAt: checkedOutIso,
          },
          signatureHash: contractSignatureHash([
            termination.id,
            parent.tenantPartyId,
            'tenant',
            checkedOutIso,
          ]),
          signedAt: checkedOutAt,
        },
        {
          organizationId: orgId,
          contractId: termination.id,
          signerPartyId: parent.ownerPartyId,
          signerRole: 'owner',
          method: 'system_on_checkout',
          evidence: {
            bookingReference: booking.referenceCode,
            kind: 'stay_checkout_termination',
            onBehalfOf: 'owner',
            checkedOutAt: checkedOutIso,
            recordedBy: input.recordedBy ?? null,
          },
          signatureHash: contractSignatureHash([
            termination.id,
            parent.ownerPartyId,
            'owner',
            checkedOutIso,
          ]),
          signedAt: checkedOutAt,
        },
      ])
      .onConflictDoNothing();
  }

  await tx
    .update(contracts)
    .set({
      status: parent.status === 'void' ? parent.status : 'terminated',
      payloadSnapshot: {
        ...snapshot,
        stayType: stayType as StayPeriodType | null,
        terminationSync: {
          at: checkedOutIso,
          terminationContractId: termination?.id ?? null,
          terminationReference: reference,
          lateReturn,
          cancelledAt: checkedOutIso,
          effectiveOn,
        },
      },
      updatedAt: now,
    })
    .where(and(eq(contracts.id, parent.id), eq(contracts.organizationId, orgId)));

  if (lease && !repaired) {
    // Lease already terminal; still attach termination id on a soft workflow note is optional.
  } else if (lease && repaired && termination) {
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: input.actorUserId,
      resourceType: 'contract',
      resourceId: termination.id,
      eventType: 'contract.termination_issued',
      fromStatus: null,
      toStatus: 'signed',
      metadata: {
        parentContractId: parent.id,
        stayBookingId: booking.id,
        referenceCode: booking.referenceCode,
        lateReturn,
      },
    });
  }

  return {
    leaseId: lease?.id ?? null,
    terminationId: termination?.id ?? null,
    terminationReference: reference,
    lateReturn,
    repaired: repaired || Boolean(termination),
  };
}

/** Close every checked-out stay whose lease is still open (owner home / leasing repair). */
export async function repairOpenStayLeasesAfterCheckoutInTx(
  tx: Tx,
  orgId: string,
  limit = 40,
): Promise<number> {
  const rows = await tx.execute(sql`
    select b.id as booking_id
    from stay_bookings b
    inner join contracts c
      on c.organization_id = b.organization_id
     and c.parent_contract_id is null
     and c.payload_snapshot->'source'->>'stayBookingId' = b.id::text
    inner join leases l
      on l.contract_id = c.id
     and l.organization_id = b.organization_id
    where b.organization_id = ${orgId}::uuid
      and b.status in ('checked_out', 'closed')
      and l.status in ('active', 'cancel_requested', 'clearance_pending')
    limit ${limit}
  `);
  const bookingIds = rowsOf<{ booking_id: string }>(rows).map((row) => row.booking_id);

  let closed = 0;
  for (const bookingId of bookingIds) {
    const result = await closeStayContractAfterCheckoutInTx(tx, {
      organizationId: orgId,
      bookingId,
      actorUserId: null,
      recordedBy: 'system_repair',
    });
    if (result.repaired || result.terminationId) closed += 1;
  }
  return closed;
}
