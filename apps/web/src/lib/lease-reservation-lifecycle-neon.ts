import 'server-only';
import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import {
  contracts,
  leases,
  outboxEvents,
  properties,
  reservations,
  salesDeals,
  units,
  users,
  workflowEvents,
} from '@bhd-r/db';
import { SYSTEM_APPROVER_AR } from '@/lib/approval-policy';
import { brandUploadedPhoto } from '@/lib/brand-uploaded-photo';
import { issueHandoverPass, openHandoverPass, verifyHandoverCode } from '@/lib/handover-pass';
import { HANDOVER_PHOTOS_MAX, HANDOVER_PHOTO_MAX } from '@/lib/stay-handover';
import { delegateClaims, resolveApprovalPolicy } from '@/lib/approval-policy-neon';
import { clientSafeErrorCode } from '@/lib/client-safe-error';
import { applySessionSettings, viewerTenantSettings } from '@/lib/db-session-settings';
import {
  HANDOVER_DEFECTS_HOURS,
  REQUIREMENT_FILE_MAX_CHARS,
  REQUIREMENT_FILE_TYPES,
  handoverAwaitingTenant,
  handoverDefectsOpen,
  leaseJourneyPhase,
  lifecycleOf,
  type HandoverPhotoMeta,
  type LeaseJourneyPhase,
  type ReservationCancelReason,
  type ReservationLifecycle,
  type ReservationRequirement,
  type ReservationSaleDraft,
} from '@/lib/lease-reservation-lifecycle';
import {
  assertLeaseTermsValid,
  completeCounterpartySignatureInTx,
  decimalToMinor,
  issueManualLeaseInTx,
  issueReservationSaleInTx,
  type ManualLeaseInput,
} from '@/lib/property-contracts-neon';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';
import { applyOrgScope, getDatabase, withElevatedRead, type Tx } from '@/lib/public-booking-neon';
import {
  LEASE_BOOKING_FLOW,
  assertBookingOwner,
  findLeaseReservation,
  leaseBookingFail,
  lockKey,
  normalizeLeaseReference,
  type LeaseBookingSnapshot,
} from '@/lib/public-lease-booking-neon';

/** A paid booking stays held this long after each owner step, so paperwork never races the expiry job. */
const HOLD_EXTENSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_REQUIREMENTS = 12;
const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/;
const SIGNATURE_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

function fail(code: string): never {
  throw new Error(code);
}

function phaseOf(status: string, snapshot: LeaseBookingSnapshot, lifecycle: ReservationLifecycle) {
  return leaseJourneyPhase({
    status,
    depositPaidAt: snapshot.depositPaidAt ?? null,
    esignSignedAt: snapshot.esign?.signedAt ?? null,
    lifecycle,
  });
}

function extendedHold(current: Date): Date {
  const extended = new Date(Date.now() + HOLD_EXTENSION_MS);
  return extended > current ? extended : current;
}

async function viewerName(tx: Tx, userId: string): Promise<string | null> {
  const [row] = await tx
    .select({ name: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.name ?? null;
}

async function loadForOwner(tx: Tx, claims: SessionClaims, reservationId: string) {
  const orgId = claims.organizationId ?? fail('organization_required');
  return loadReservationRow(tx, orgId, reservationId, ownerPartyScope(claims));
}

async function loadReservationRow(
  tx: Tx,
  orgId: string,
  reservationId: string,
  ownerPartyId: string | null,
) {
  await lockKey(tx, reservationId);
  const [row] = await tx
    .select({
      id: reservations.id,
      status: reservations.status,
      unitId: reservations.unitId,
      tenantPartyId: reservations.tenantPartyId,
      expiresAt: reservations.expiresAt,
      termsSnapshot: reservations.termsSnapshot,
      propertyId: properties.id,
      currency: units.currency,
    })
    .from(reservations)
    .innerJoin(units, eq(units.id, reservations.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(
      and(
        eq(reservations.id, reservationId),
        eq(reservations.organizationId, orgId),
        sql`${reservations.termsSnapshot}->>'flow' = ${LEASE_BOOKING_FLOW}`,
        ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
      ),
    )
    .limit(1);
  if (!row) fail('reservation_not_found');
  const snapshot = row.termsSnapshot as unknown as LeaseBookingSnapshot;
  return { ...row, orgId, snapshot, lifecycle: lifecycleOf(snapshot) };
}

type OwnerRow = Awaited<ReturnType<typeof loadReservationRow>>;

async function saveLifecycle(
  tx: Tx,
  row: { id: string; snapshot: LeaseBookingSnapshot },
  lifecycle: ReservationLifecycle,
  patch: {
    status?: 'converted' | 'cancelled';
    convertedLeaseId?: string | null;
    expiresAt?: Date;
  } = {},
) {
  await tx
    .update(reservations)
    .set({
      termsSnapshot: { ...row.snapshot, lifecycle },
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.convertedLeaseId !== undefined ? { convertedLeaseId: patch.convertedLeaseId } : {}),
      ...(patch.expiresAt ? { expiresAt: patch.expiresAt } : {}),
      updatedAt: new Date(),
    })
    .where(eq(reservations.id, row.id));
}

async function logEvent(
  tx: Tx,
  input: {
    orgId: string;
    actorUserId: string | null;
    reservationId: string;
    eventType: string;
    status: string;
    toStatus?: string;
    metadata: Record<string, unknown>;
  },
) {
  await tx.insert(workflowEvents).values({
    organizationId: input.orgId,
    actorUserId: input.actorUserId,
    resourceType: 'reservation',
    resourceId: input.reservationId,
    eventType: input.eventType,
    fromStatus: input.status,
    toStatus: input.toStatus ?? input.status,
    metadata: input.metadata,
  });
}

export type RequirementInput = { code: string; labelAr: string; labelEn: string };

export type ReservationOwnerAction =
  | { action: 'confirm_payment' }
  | { action: 'reject_payment'; note: string }
  | { action: 'approve' }
  | {
      action: 'verify_document';
      code: string;
      decision: 'verified' | 'rejected';
      note?: string | undefined;
    }
  | {
      action: 'save_contract';
      lease?: ManualLeaseInput | undefined;
      sale?: ReservationSaleDraft | undefined;
      requirements: RequirementInput[];
    }
  | {
      action: 'review_document';
      code: string;
      decision: 'approved' | 'rejected';
      note?: string | undefined;
    }
  | { action: 'issue_contract' }
  | {
      action: 'record_handover';
      on: string;
      recipientName: string;
      keys?: string | undefined;
      electricityReading?: string | undefined;
      waterReading?: string | undefined;
      notes?: string | undefined;
    };

function cleanRequirements(
  input: RequirementInput[],
  existing: ReservationRequirement[],
): ReservationRequirement[] {
  if (input.length > MAX_REQUIREMENTS) fail('requirements_invalid');
  const seen = new Set<string>();
  return input.map((item) => {
    const code = item.code.trim();
    const labelAr = item.labelAr.trim().slice(0, 120);
    const labelEn = item.labelEn.trim().slice(0, 120) || labelAr;
    if (!/^[a-z0-9_]{2,40}$/.test(code) || !labelAr || seen.has(code)) fail('requirements_invalid');
    seen.add(code);
    const kept = existing.find((entry) => entry.code === code);
    return kept ? { ...kept, labelAr, labelEn } : { code, labelAr, labelEn, status: 'pending' };
  });
}

function assertOpen(row: OwnerRow) {
  if (row.status === 'cancelled' || row.status === 'expired' || row.lifecycle.cancellation) {
    fail('reservation_closed');
  }
}

/** Signs the prepared contract for the owner and sends it to the tenant or buyer to sign. */
async function issueReservationContract(
  tx: Tx,
  claims: SessionClaims,
  row: OwnerRow,
  lifecycle: ReservationLifecycle,
  issuer: { byName: string | null; automatic: boolean },
) {
  const draft = lifecycle.contractDraft ?? fail('reservation_not_ready');
  const source = {
    type: 'lease_reservation',
    reservationId: row.id,
    referenceCode: row.snapshot.referenceCode,
    ...(issuer.automatic ? { automatic: true } : {}),
  };
  let outcome: { contractId: string; contractReference: string };
  if (row.snapshot.mode === 'sale') {
    if (!hasPermission(claims, 'sale.manage') || !draft.sale) fail('forbidden');
    outcome = await issueReservationSaleInTx(tx, claims, row.propertyId, {
      unitId: row.unitId,
      buyerPartyId: row.tenantPartyId,
      dealId: row.snapshot.salesDealId ?? null,
      signedOn: draft.sale.signedOn,
      amount: draft.sale.amount,
      notes: draft.sale.notes,
      source,
    });
  } else {
    if (!hasPermission(claims, 'lease.create') || !draft.lease) fail('forbidden');
    const lease = draft.lease as unknown as ManualLeaseInput;
    outcome = await issueManualLeaseInTx(
      tx,
      claims,
      row.propertyId,
      {
        ...lease,
        unitId: row.unitId,
        tenant: { ...lease.tenant, partyId: row.tenantPartyId },
      },
      { source, awaitCounterparty: true },
    );
  }
  const next: ReservationLifecycle = {
    ...lifecycle,
    contract: {
      id: outcome.contractId,
      reference: outcome.contractReference,
      issuedAt: new Date().toISOString(),
      byName: issuer.byName,
      ...(issuer.automatic ? { automatic: true } : {}),
    },
  };
  await saveLifecycle(tx, row, next, { expiresAt: extendedHold(row.expiresAt) });
  return { outcome, lifecycle: next };
}

/**
 * Cancels a booking whose payment never arrived or whose documents broke the requirements.
 * An issued contract is voided (terminated once both signed) and its lease cancelled; only a
 * booking whose premises were handed over can no longer be cancelled here.
 */
async function cancelReservationInTx(
  tx: Tx,
  row: OwnerRow,
  lifecycle: ReservationLifecycle,
  input: {
    actorUserId: string;
    byName: string | null;
    reason: ReservationCancelReason;
    note: string | null;
    code?: string | null;
  },
) {
  if (lifecycle.handover) fail('reservation_not_ready');
  const now = new Date();
  const contract = lifecycle.contract;
  if (contract) {
    const [current] = await tx
      .select({ status: contracts.status })
      .from(contracts)
      .where(and(eq(contracts.id, contract.id), eq(contracts.organizationId, row.orgId)))
      .limit(1);
    if (current && current.status !== 'void' && current.status !== 'terminated') {
      await tx
        .update(contracts)
        .set({ status: current.status === 'signed' ? 'terminated' : 'void', updatedAt: now })
        .where(and(eq(contracts.id, contract.id), eq(contracts.organizationId, row.orgId)));
    }
    await tx
      .update(leases)
      .set({ status: 'cancelled', updatedAt: now })
      .where(
        and(
          eq(leases.organizationId, row.orgId),
          eq(leases.contractId, contract.id),
          inArray(leases.status, ['draft', 'active']),
        ),
      );
  }
  if (row.snapshot.salesDealId) {
    await tx
      .update(salesDeals)
      .set({ status: 'cancelled', updatedAt: now })
      .where(
        and(eq(salesDeals.id, row.snapshot.salesDealId), eq(salesDeals.organizationId, row.orgId)),
      );
  }
  const next: ReservationLifecycle = {
    ...lifecycle,
    cancellation: {
      at: now.toISOString(),
      byName: input.byName,
      reason: input.reason,
      note: input.note,
      ...(input.code ? { code: input.code } : {}),
    },
  };
  await saveLifecycle(tx, row, next, { status: 'cancelled' });
  await logEvent(tx, {
    orgId: row.orgId,
    actorUserId: input.actorUserId,
    reservationId: row.id,
    eventType: 'reservation.cancelled',
    status: row.status,
    toStatus: 'cancelled',
    metadata: {
      referenceCode: row.snapshot.referenceCode,
      byName: input.byName,
      reason: input.reason,
      note: input.note,
      ...(input.code ? { code: input.code } : {}),
      ...(contract ? { contractId: contract.id } : {}),
    },
  });
  await tx.insert(outboxEvents).values({
    organizationId: row.orgId,
    topic: 'reservation.cancelled',
    aggregateType: 'reservation',
    aggregateId: row.id,
    payload: { referenceCode: row.snapshot.referenceCode, reason: input.reason },
  });
  return next;
}

/**
 * Owner (or a representative with the right permissions) moves a website booking forward:
 * approve it, prepare the contract and the documents it needs, review those documents,
 * approve the contract for the tenant to sign, and hand the premises over.
 */
export async function reservationOwnerAction(
  claims: SessionClaims,
  reservationId: string,
  input: ReservationOwnerAction,
  options: { defer?: (task: () => Promise<unknown>) => void } = {},
): Promise<{
  phase: LeaseJourneyPhase;
  contractId?: string;
  contractReference?: string;
  automationPending?: boolean;
}> {
  const result = await ownerActionInTx(claims, reservationId, input);
  if (!AUTOMATION_TRIGGERS.has(input.action)) return result;
  if (options.defer && input.action === 'review_document') {
    options.defer(() => runReservationAutomation(reservationId, claims.sub));
    return { ...result, automationPending: true };
  }
  const phase = await runReservationAutomation(reservationId, claims.sub);
  return phase ? { ...result, phase } : result;
}

/** Owner steps after which the system may take the next one on the owner's behalf. */
const AUTOMATION_TRIGGERS = new Set<ReservationOwnerAction['action']>([
  'confirm_payment',
  'save_contract',
  'review_document',
]);

async function ownerActionInTx(
  claims: SessionClaims,
  reservationId: string,
  input: ReservationOwnerAction,
): Promise<{ phase: LeaseJourneyPhase; contractId?: string; contractReference?: string }> {
  if (!hasPermission(claims, 'reservation.manage')) fail('forbidden');
  return withinViewerTenant(claims, async (tx) => {
    const row = await loadForOwner(tx, claims, reservationId);
    assertOpen(row);
    const now = new Date();
    const at = now.toISOString();
    const byName = await viewerName(tx, claims.sub);
    const phase = phaseOf(row.status, row.snapshot, row.lifecycle);
    const sale = row.snapshot.mode === 'sale';
    const event = (eventType: string, metadata: Record<string, unknown>, toStatus?: string) =>
      logEvent(tx, {
        orgId: row.orgId,
        actorUserId: claims.sub,
        reservationId: row.id,
        eventType,
        status: row.status,
        ...(toStatus ? { toStatus } : {}),
        metadata: { referenceCode: row.snapshot.referenceCode, byName, ...metadata },
      });

    switch (input.action) {
      case 'confirm_payment': {
        const review = row.lifecycle.paymentReview;
        if (!review || review.status !== 'pending') break;
        await saveLifecycle(tx, row, {
          ...row.lifecycle,
          paymentReview: { ...review, status: 'confirmed', confirmedAt: at, byName },
        });
        await event('reservation.payment_confirmed', {});
        break;
      }

      case 'reject_payment': {
        if (row.lifecycle.paymentReview?.status !== 'pending') fail('reservation_not_ready');
        const note = input.note.trim().slice(0, 500);
        if (!note) fail('invalid_body');
        await cancelReservationInTx(tx, row, row.lifecycle, {
          actorUserId: claims.sub,
          byName,
          reason: 'payment_not_received',
          note,
        });
        break;
      }

      case 'verify_document': {
        const requirements = row.lifecycle.requirements ?? [];
        const target = requirements.find((item) => item.code === input.code);
        if (!target) fail('requirement_not_found');
        if (!target.autoApproved || target.verifiedAt || row.lifecycle.handover) {
          fail('reservation_not_ready');
        }
        if (input.decision === 'verified') {
          const next = requirements.map((item) =>
            item.code === input.code ? { ...item, verifiedAt: at, verifiedByName: byName } : item,
          );
          await saveLifecycle(tx, row, { ...row.lifecycle, requirements: next });
          await event('reservation.document_verified', { code: input.code });
          break;
        }
        const note = input.note?.trim().slice(0, 500) || null;
        if (!note) fail('invalid_body');
        const next = requirements.map((item) =>
          item.code === input.code
            ? {
                ...item,
                status: 'rejected' as const,
                note,
                verifiedAt: at,
                verifiedByName: byName,
              }
            : item,
        );
        await cancelReservationInTx(
          tx,
          row,
          { ...row.lifecycle, requirements: next },
          {
            actorUserId: claims.sub,
            byName,
            reason: 'documents_invalid',
            note,
            code: input.code,
          },
        );
        break;
      }

      case 'approve': {
        if (row.lifecycle.approval) break;
        if (phase !== 'awaiting_owner_approval' || row.status !== 'confirmed') {
          fail('reservation_not_ready');
        }
        const lifecycle: ReservationLifecycle = {
          ...row.lifecycle,
          approval: { at, byUserId: claims.sub, byName },
        };
        await saveLifecycle(tx, row, lifecycle, { expiresAt: extendedHold(row.expiresAt) });
        await event('reservation.owner_approved', {});
        await tx.insert(outboxEvents).values({
          organizationId: row.orgId,
          topic: 'reservation.owner_approved',
          aggregateType: 'reservation',
          aggregateId: row.id,
          payload: { referenceCode: row.snapshot.referenceCode, mode: row.snapshot.mode },
        });
        break;
      }

      case 'save_contract': {
        if (!hasPermission(claims, 'contract.create')) fail('forbidden');
        if (!row.lifecycle.approval || row.lifecycle.contract) fail('reservation_not_ready');
        let draft: NonNullable<ReservationLifecycle['contractDraft']>;
        if (sale) {
          if (!input.sale) fail('invalid_body');
          if (decimalToMinor(input.sale.amount, row.currency) <= 0n) fail('invalid_amount');
          if (!/^\d{4}-\d{2}-\d{2}$/.test(input.sale.signedOn)) fail('invalid_dates');
          draft = { savedAt: at, byName, sale: input.sale };
        } else {
          if (!input.lease) fail('invalid_body');
          assertLeaseTermsValid(input.lease.terms, row.currency);
          const lease: ManualLeaseInput = {
            ...input.lease,
            unitId: row.unitId,
            tenant: { ...input.lease.tenant, partyId: row.tenantPartyId },
          };
          draft = { savedAt: at, byName, lease };
        }
        const requirements = cleanRequirements(
          input.requirements,
          row.lifecycle.requirements ?? [],
        );
        await saveLifecycle(tx, row, { ...row.lifecycle, contractDraft: draft, requirements });
        await event('reservation.contract_prepared', {
          requirements: requirements.map((item) => item.code),
        });
        break;
      }

      case 'review_document': {
        if (row.lifecycle.contract) fail('reservation_not_ready');
        const requirements = row.lifecycle.requirements ?? [];
        const target = requirements.find((item) => item.code === input.code);
        if (!target) fail('requirement_not_found');
        if (!target.file) fail('reservation_not_ready');
        const note = input.note?.trim().slice(0, 500) || null;
        if (input.decision === 'rejected' && !note) fail('invalid_body');
        const next = requirements.map((item) =>
          item.code === input.code
            ? {
                ...item,
                status: input.decision,
                note: input.decision === 'rejected' ? note : null,
                reviewedAt: at,
                reviewedByName: byName,
              }
            : item,
        );
        await saveLifecycle(tx, row, { ...row.lifecycle, requirements: next });
        await event(`reservation.document_${input.decision}`, { code: input.code });
        break;
      }

      case 'issue_contract': {
        if (row.lifecycle.contract) {
          return {
            phase,
            contractId: row.lifecycle.contract.id,
            contractReference: row.lifecycle.contract.reference,
          };
        }
        if (!hasPermission(claims, 'contract.create') || !hasPermission(claims, 'contract.sign')) {
          fail('forbidden');
        }
        if (phase === 'awaiting_documents' || phase === 'awaiting_documents_review') {
          fail('documents_incomplete');
        }
        if (phase !== 'awaiting_contract_approval') fail('reservation_not_ready');
        const { outcome, lifecycle } = await issueReservationContract(
          tx,
          claims,
          row,
          row.lifecycle,
          { byName, automatic: false },
        );
        await event('reservation.contract_issued', {
          contractId: outcome.contractId,
          contractReference: outcome.contractReference,
        });
        return {
          phase: phaseOf(row.status, row.snapshot, lifecycle),
          contractId: outcome.contractId,
          contractReference: outcome.contractReference,
        };
      }

      case 'record_handover': {
        if (row.lifecycle.handover) break;
        if (!row.lifecycle.tenantSignature) fail('reservation_not_ready');
        const recipientName = input.recipientName.trim().slice(0, 120);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(input.on) || recipientName.length < 2) {
          fail('handover_invalid');
        }
        const text = (value: string | undefined, max: number) =>
          value?.trim().slice(0, max) || null;
        const lifecycle: ReservationLifecycle = {
          ...row.lifecycle,
          handover: {
            at,
            on: input.on,
            byName,
            recipientName,
            keys: text(input.keys, 200),
            electricityReading: text(input.electricityReading, 40),
            waterReading: text(input.waterReading, 40),
            notes: text(input.notes, 1000),
          },
        };
        await saveLifecycle(tx, row, lifecycle);
        await event('reservation.handed_over', { on: input.on, recipientName });
        break;
      }
    }

    const [fresh] = await tx
      .select({ status: reservations.status, termsSnapshot: reservations.termsSnapshot })
      .from(reservations)
      .where(eq(reservations.id, row.id))
      .limit(1);
    const snapshot = (fresh?.termsSnapshot ?? row.snapshot) as unknown as LeaseBookingSnapshot;
    return { phase: phaseOf(fresh?.status ?? row.status, snapshot, lifecycleOf(snapshot)) };
  });
}

/**
 * Takes every step the owner's approval policy hands to the system: approves a paid, signed
 * booking, and once all required documents are in, accepts them and approves the contract in
 * the policy delegate's name. Runs in its own transaction after the step that triggered it, so a
 * failure (an overlapping lease, a delegate who lost signing rights) leaves the step to the owner.
 * Returns the booking's phase afterwards, or null when nothing could be read.
 */
export async function runReservationAutomation(
  reservationId: string,
  actorUserId: string,
): Promise<LeaseJourneyPhase | null> {
  const { db } = getDatabase();
  try {
    return await db.transaction(async (tx) => {
      const [base] = await withElevatedRead(tx, () =>
        tx
          .select({
            orgId: reservations.organizationId,
            propertyId: units.propertyId,
            flow: sql<string | null>`${reservations.termsSnapshot}->>'flow'`,
          })
          .from(reservations)
          .innerJoin(units, eq(units.id, reservations.unitId))
          .where(eq(reservations.id, reservationId))
          .limit(1),
      );
      if (!base || base.flow !== LEASE_BOOKING_FLOW) return null;
      const resolved = await resolveApprovalPolicy(tx, base.orgId, base.propertyId);
      const { policy, delegate } = resolved;
      const signer =
        policy.contract === 'auto' && delegate
          ? await delegateClaims(tx, base.orgId, delegate)
          : null;
      if (signer) {
        await applySessionSettings(tx, viewerTenantSettings(signer));
      } else {
        await applyOrgScope(tx, { organizationId: base.orgId, userId: actorUserId });
      }

      const row = await loadReservationRow(tx, base.orgId, reservationId, null);
      let lifecycle = row.lifecycle;
      const phase = () => phaseOf(row.status, row.snapshot, lifecycle);
      if (row.status === 'cancelled' || row.status === 'expired' || lifecycle.cancellation) {
        return phase();
      }
      const at = new Date().toISOString();
      const event = (eventType: string, metadata: Record<string, unknown>) =>
        logEvent(tx, {
          orgId: row.orgId,
          actorUserId: delegate?.userId ?? null,
          reservationId: row.id,
          eventType,
          status: row.status,
          metadata: {
            referenceCode: row.snapshot.referenceCode,
            byName: SYSTEM_APPROVER_AR,
            automatic: true,
            policySource: resolved.source,
            ...metadata,
          },
        });

      if (
        policy.booking === 'auto' &&
        row.status === 'confirmed' &&
        phase() === 'awaiting_owner_approval'
      ) {
        lifecycle = {
          ...lifecycle,
          approval: {
            at,
            byUserId: delegate?.userId ?? null,
            byName: SYSTEM_APPROVER_AR,
            automatic: true,
          },
        };
        await saveLifecycle(tx, row, lifecycle, { expiresAt: extendedHold(row.expiresAt) });
        await event('reservation.owner_approved', {});
        await tx.insert(outboxEvents).values({
          organizationId: row.orgId,
          topic: 'reservation.owner_approved',
          aggregateType: 'reservation',
          aggregateId: row.id,
          payload: {
            referenceCode: row.snapshot.referenceCode,
            mode: row.snapshot.mode,
            automatic: true,
          },
        });
      }

      const ready =
        phase() === 'awaiting_documents_review' || phase() === 'awaiting_contract_approval';
      if (policy.contract === 'auto' && ready && lifecycle.contractDraft && !lifecycle.contract) {
        if (!signer) {
          await event('reservation.auto_contract_skipped', { reason: 'delegate_unavailable' });
          return phase();
        }
        const submitted = (lifecycle.requirements ?? []).filter(
          (item) => item.status === 'submitted',
        );
        if (submitted.length) {
          lifecycle = {
            ...lifecycle,
            requirements: (lifecycle.requirements ?? []).map((item) =>
              item.status === 'submitted'
                ? {
                    ...item,
                    status: 'approved' as const,
                    note: null,
                    autoApproved: true,
                    reviewedAt: at,
                    reviewedByName: SYSTEM_APPROVER_AR,
                  }
                : item,
            ),
          };
          await saveLifecycle(tx, row, lifecycle);
          await event('reservation.documents_auto_accepted', {
            codes: submitted.map((item) => item.code),
          });
        }
        try {
          const issued = await tx.transaction((savepoint) =>
            issueReservationContract(savepoint, signer, row, lifecycle, {
              byName: SYSTEM_APPROVER_AR,
              automatic: true,
            }),
          );
          lifecycle = issued.lifecycle;
          await event('reservation.contract_issued', {
            contractId: issued.outcome.contractId,
            contractReference: issued.outcome.contractReference,
            signedForOwnerBy: delegate?.name ?? null,
          });
        } catch (error) {
          await event('reservation.auto_contract_skipped', {
            reason: clientSafeErrorCode(error, 'issue_failed'),
          });
        }
      }
      return phase();
    });
  } catch (error) {
    console.error('reservation automation failed', error);
    return null;
  }
}

async function customerReservation(transaction: Tx, userId: string, referenceCode: string) {
  const normalized = normalizeLeaseReference(referenceCode);
  if (!normalized) leaseBookingFail('not_found');
  const match = await findLeaseReservation(transaction, 'referenceCode', normalized);
  if (!match) leaseBookingFail('not_found');
  await assertBookingOwner(transaction, userId, match.partyEmail);
  await applyOrgScope(transaction, { organizationId: match.organizationId, userId });
  await lockKey(transaction, match.id);
  const [fresh] = await transaction
    .select({ status: reservations.status, termsSnapshot: reservations.termsSnapshot })
    .from(reservations)
    .where(eq(reservations.id, match.id))
    .limit(1);
  if (!fresh) leaseBookingFail('not_found');
  const snapshot = fresh.termsSnapshot as unknown as LeaseBookingSnapshot;
  const lifecycle = lifecycleOf(snapshot);
  return {
    match,
    status: fresh.status,
    snapshot,
    lifecycle,
    phase: phaseOf(fresh.status, snapshot, lifecycle),
  };
}

/** The customer sends one of the documents the owner asked for (image or PDF as a data URL). */
export async function submitReservationDocument(
  claims: SessionClaims,
  referenceCode: string,
  input: { code: string; fileName: string; dataUrl: string },
) {
  const parsed = DATA_URL.exec(input.dataUrl);
  if (
    !parsed ||
    !REQUIREMENT_FILE_TYPES.includes(parsed[1]!) ||
    input.dataUrl.length > REQUIREMENT_FILE_MAX_CHARS
  ) {
    leaseBookingFail('invalid_file');
  }
  const mime = parsed[1]!;
  const size = Math.floor((parsed[2]!.length * 3) / 4);
  const { db } = getDatabase();
  const reservationId = await db.transaction(async (transaction) => {
    const current = await customerReservation(transaction, claims.sub, referenceCode);
    if (current.phase !== 'awaiting_documents' && current.phase !== 'awaiting_documents_review') {
      leaseBookingFail('not_ready');
    }
    const requirements = current.lifecycle.requirements ?? [];
    const target = requirements.find((item) => item.code === input.code);
    if (!target) leaseBookingFail('requirement_not_found');
    if (target.status === 'approved') leaseBookingFail('not_ready');

    const submittedAt = new Date().toISOString();
    const name = input.fileName.trim().slice(0, 120) || `${input.code}`;
    // Files live on their own resource type so reservation timelines stay light.
    const [stored] = await transaction
      .insert(workflowEvents)
      .values({
        organizationId: current.match.organizationId,
        actorUserId: claims.sub,
        resourceType: 'reservation_document',
        resourceId: current.match.id,
        eventType: 'reservation.document_file',
        metadata: {
          referenceCode: current.snapshot.referenceCode,
          code: input.code,
          name,
          mime,
          size,
          dataUrl: input.dataUrl,
        },
      })
      .returning({ id: workflowEvents.id });
    const next = requirements.map((item) =>
      item.code === input.code
        ? {
            ...item,
            status: 'submitted' as const,
            note: null,
            file: { eventId: stored!.id, name, mime, size, submittedAt },
          }
        : item,
    );
    await saveLifecycle(
      transaction,
      { id: current.match.id, snapshot: current.snapshot },
      { ...current.lifecycle, requirements: next },
    );
    await logEvent(transaction, {
      orgId: current.match.organizationId,
      actorUserId: claims.sub,
      reservationId: current.match.id,
      eventType: 'reservation.document_submitted',
      status: current.status,
      metadata: { referenceCode: current.snapshot.referenceCode, code: input.code },
    });
    return current.match.id;
  });
  await runReservationAutomation(reservationId, claims.sub);
  return { submitted: true as const, code: input.code };
}

/**
 * The tenant (or buyer) signs the contract the owner approved. The contract becomes signed by
 * both parties, its lease starts, and the booking is converted.
 */
export async function signReservationContract(
  claims: SessionClaims,
  referenceCode: string,
  input: { signaturePng: string },
) {
  if (!SIGNATURE_IMAGE.test(input.signaturePng)) leaseBookingFail('invalid_file');
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    const current = await customerReservation(transaction, claims.sub, referenceCode);
    const contract = current.lifecycle.contract;
    if (current.lifecycle.tenantSignature && contract) {
      return {
        signed: true as const,
        contractId: contract.id,
        signedAt: current.lifecycle.tenantSignature.signedAt,
      };
    }
    if (current.phase !== 'awaiting_tenant_signature' || !contract) leaseBookingFail('not_ready');

    const orgId = current.match.organizationId;
    const signedAt = new Date();
    const [evidence] = await transaction
      .insert(workflowEvents)
      .values({
        organizationId: orgId,
        actorUserId: claims.sub,
        resourceType: 'reservation_contract_esign',
        resourceId: current.match.id,
        eventType: 'reservation.contract_esign_evidence',
        metadata: {
          referenceCode: current.snapshot.referenceCode,
          contractId: contract.id,
          signedAt: signedAt.toISOString(),
          signaturePng: input.signaturePng,
        },
      })
      .returning({ id: workflowEvents.id });
    const result = await completeCounterpartySignatureInTx(transaction, {
      orgId,
      contractId: contract.id,
      actorUserId: claims.sub,
      signature: {
        partyId: current.match.tenantPartyId,
        method: 'reservation_contract_esign',
        evidence: {
          referenceCode: current.snapshot.referenceCode,
          evidenceEventId: evidence!.id,
          signedByUserId: claims.sub,
          reservationEsignEventId: current.snapshot.esign?.evidenceEventId ?? null,
        },
        signedAt,
      },
    });
    const lifecycle: ReservationLifecycle = {
      ...current.lifecycle,
      tenantSignature: { signedAt: signedAt.toISOString(), evidenceEventId: evidence!.id },
    };
    await saveLifecycle(
      transaction,
      { id: current.match.id, snapshot: current.snapshot },
      lifecycle,
      { status: 'converted', convertedLeaseId: result.leaseId },
    );
    await logEvent(transaction, {
      orgId,
      actorUserId: claims.sub,
      reservationId: current.match.id,
      eventType: 'reservation.converted',
      status: current.status,
      toStatus: 'converted',
      metadata: {
        referenceCode: current.snapshot.referenceCode,
        contractId: contract.id,
        contractReference: result.contractReference,
        leaseId: result.leaseId,
      },
    });
    await transaction.insert(outboxEvents).values({
      organizationId: orgId,
      topic: 'reservation.converted',
      aggregateType: 'reservation',
      aggregateId: current.match.id,
      payload: {
        referenceCode: current.snapshot.referenceCode,
        contractId: contract.id,
        leaseId: result.leaseId,
      },
    });
    return { signed: true as const, contractId: contract.id, signedAt: signedAt.toISOString() };
  });
}

export type ReservationFileKind =
  'signature' | 'id-front' | 'id-back' | 'selfie' | 'contract-signature' | `doc-${string}`;

const ESIGN_FIELDS: Record<string, string> = {
  signature: 'signaturePng',
  'id-front': 'idFrontPng',
  'id-back': 'idBackPng',
  selfie: 'selfiePng',
};

/**
 * Identity captures, signatures and requested documents of a website booking, for staff
 * of its organization (and an individual owner on their own property only).
 */
export async function readReservationFileForStaff(
  claims: SessionClaims,
  reservationId: string,
  file: string,
): Promise<{ mimeType: string; bytes: Buffer; name: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(reservationId)) return null;
  if (!claims.organizationId || !hasPermission(claims, 'reservation.read')) return null;
  const handoverPhoto = HANDOVER_PHOTO_FILE.test(file);
  const identity =
    file !== 'signature' &&
    file !== 'contract-signature' &&
    (!handoverPhoto || file === 'handover-recipient');
  if (identity && !hasPermission(claims, 'reservation.manage')) return null;
  const { db } = getDatabase();
  const dataUrl = await db.transaction(async (transaction) => {
    const match = await findLeaseReservation(transaction, 'id', reservationId);
    if (!match || match.organizationId !== claims.organizationId) return null;
    const ownerPartyId = ownerPartyScope(claims);
    if (ownerPartyId && match.ownerPartyId !== ownerPartyId) return null;
    const lifecycle = lifecycleOf(match.snapshot);
    if (handoverPhoto) {
      const value = await handoverPhotoDataUrl(transaction, match.organizationId, lifecycle, file);
      return value ? { value, name: `${match.snapshot.referenceCode}-${file}` } : null;
    }
    let eventId: string | null = null;
    let path: string[] = [];
    let name = file;
    if (file in ESIGN_FIELDS) {
      eventId = match.snapshot.esign?.evidenceEventId ?? null;
      path = ['esign', ESIGN_FIELDS[file]!];
    } else if (file === 'contract-signature') {
      eventId = lifecycle.tenantSignature?.evidenceEventId ?? null;
      path = ['signaturePng'];
    } else if (file.startsWith('doc-')) {
      const requirement = (lifecycle.requirements ?? []).find(
        (item) => item.code === file.slice(4),
      );
      eventId = requirement?.file?.eventId ?? null;
      name = requirement?.file?.name ?? file;
      path = ['dataUrl'];
    }
    if (!eventId || !path.length) return null;
    const id = eventId;
    const value = await withElevatedRead(transaction, async () => {
      const [row] = await transaction
        .select({ metadata: workflowEvents.metadata })
        .from(workflowEvents)
        .where(
          and(eq(workflowEvents.id, id), eq(workflowEvents.organizationId, match.organizationId)),
        )
        .limit(1);
      let cursor: unknown = row?.metadata;
      for (const key of path) {
        cursor =
          cursor && typeof cursor === 'object' ? (cursor as Record<string, unknown>)[key] : null;
      }
      return typeof cursor === 'string' ? cursor : null;
    });
    return value ? { value, name } : null;
  });
  if (!dataUrl) return null;
  const parsed = DATA_URL.exec(dataUrl.value);
  if (!parsed) return null;
  const mimeType = parsed[1]!;
  if (!mimeType.startsWith('image/') && mimeType !== 'application/pdf') return null;
  return { mimeType, bytes: Buffer.from(parsed[2]!, 'base64'), name: dataUrl.name };
}

// ── Handover by the tenant's pass ───────────────────────────────────────────────────────────

const HANDOVER_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export type HandoverPhotoInput = { data: string; takenAt: string; source: 'camera' | 'device' };

/** The pass the staff member scanned, or the booking reference with the six-digit code typed in. */
export type HandoverKey = { token: string } | { reference: string; code: string };

/** Each photo re-encoded once with the platform mark, keeping its fingerprint and capture facts. */
async function brandHandoverPhotos(photos: readonly HandoverPhotoInput[]) {
  const branded: Array<{ data: string; meta: HandoverPhotoMeta }> = [];
  for (const [index, photo] of photos.entries()) {
    if (!HANDOVER_IMAGE.test(photo.data) || photo.data.length > HANDOVER_PHOTO_MAX) {
      leaseBookingFail('invalid_file');
    }
    const data = await brandUploadedPhoto(photo.data, HANDOVER_PHOTO_MAX);
    const taken = Date.parse(photo.takenAt);
    branded.push({
      data,
      meta: {
        index,
        sha256: createHash('sha256').update(data).digest('hex'),
        takenAt: Number.isNaN(taken) ? null : new Date(taken).toISOString(),
        source: photo.source === 'camera' ? 'camera' : 'device',
      },
    });
  }
  return branded;
}

async function reservationIdForKey(tx: Tx, key: HandoverKey): Promise<string> {
  if ('token' in key) {
    return openHandoverPass(key.token) ?? leaseBookingFail('handover_pass_invalid');
  }
  const normalized = normalizeLeaseReference(key.reference);
  const match = normalized ? await findLeaseReservation(tx, 'referenceCode', normalized) : null;
  if (!match || !verifyHandoverCode(match.id, key.code.trim())) {
    leaseBookingFail('handover_pass_invalid');
  }
  return match.id;
}

const muscatDate = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' });

/**
 * What the tenant's booking page shows at the handover stage: a fresh pass while the keys are
 * still to be handed over, or the step after it once a staff member recorded the handover.
 */
export async function tenantHandoverPass(claims: SessionClaims, referenceCode: string) {
  const normalized = normalizeLeaseReference(referenceCode);
  if (!normalized) leaseBookingFail('not_found');
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    const match = await findLeaseReservation(transaction, 'referenceCode', normalized);
    if (!match) leaseBookingFail('not_found');
    await assertBookingOwner(transaction, claims.sub, match.partyEmail);
    const lifecycle = lifecycleOf(match.snapshot);
    const phase = phaseOf(match.status, match.snapshot, lifecycle);
    if (phase === 'handed_over') return { state: 'handed_over' as const };
    if (phase !== 'awaiting_handover') return { state: 'not_ready' as const };
    if (handoverAwaitingTenant(lifecycle)) return { state: 'awaiting_acceptance' as const };
    return { state: 'pass' as const, ...issueHandoverPass(match.id) };
  });
}

/** Who the scanned pass belongs to, for the staff member about to hand over the keys. */
export async function previewHandover(claims: SessionClaims, key: HandoverKey) {
  if (!claims.organizationId || !hasPermission(claims, 'reservation.handover')) fail('forbidden');
  return withinViewerTenant(claims, async (tx) => {
    const reservationId = await reservationIdForKey(tx, key);
    const match = await findLeaseReservation(tx, 'id', reservationId);
    if (!match || match.organizationId !== claims.organizationId) {
      leaseBookingFail('handover_pass_invalid');
    }
    const ownerPartyId = ownerPartyScope(claims);
    if (ownerPartyId && match.ownerPartyId !== ownerPartyId) {
      leaseBookingFail('handover_pass_invalid');
    }
    const lifecycle = lifecycleOf(match.snapshot);
    const phase = phaseOf(match.status, match.snapshot, lifecycle);
    const party = match.snapshot.party as { nameAr?: unknown } | undefined;
    return {
      reservationId: match.id,
      referenceCode: match.snapshot.referenceCode,
      mode: match.snapshot.mode,
      phase,
      ready: phase === 'awaiting_handover',
      awaitingTenant: handoverAwaitingTenant(lifecycle),
      tenantName:
        (typeof party?.nameAr === 'string' && party.nameAr.trim()) ||
        match.snapshot.contact?.fullName ||
        match.partyName,
      unit: { code: match.unitCode, nameAr: match.unitNameAr, nameEn: match.unitNameEn },
      property: { nameAr: match.propertyNameAr, nameEn: match.propertyNameEn },
      contractReference: lifecycle.contract?.reference ?? null,
      tenantSignedAt: lifecycle.tenantSignature?.signedAt ?? null,
      hasSelfie: Boolean(match.snapshot.esign?.evidenceEventId),
    };
  });
}

/** The selfie the tenant took when signing, so the staff member can match the face at the door. */
export async function readHandoverSelfie(
  claims: SessionClaims,
  key: HandoverKey,
): Promise<{ mimeType: string; bytes: Buffer } | null> {
  const preview = await previewHandover(claims, key);
  const { db } = getDatabase();
  const dataUrl = await db.transaction(async (transaction) => {
    const match = await findLeaseReservation(transaction, 'id', preview.reservationId);
    const eventId = match?.snapshot.esign?.evidenceEventId;
    if (!match || !eventId) return null;
    return withElevatedRead(transaction, async () => {
      const [row] = await transaction
        .select({ png: sql<string | null>`${workflowEvents.metadata}->'esign'->>'selfiePng'` })
        .from(workflowEvents)
        .where(
          and(
            eq(workflowEvents.id, eventId),
            eq(workflowEvents.organizationId, match.organizationId),
          ),
        )
        .limit(1);
      return row?.png ?? null;
    });
  });
  const parsed = dataUrl ? DATA_URL.exec(dataUrl) : null;
  if (!parsed || !parsed[1]!.startsWith('image/')) return null;
  return { mimeType: parsed[1]!, bytes: Buffer.from(parsed[2]!, 'base64') };
}

/**
 * The staff member records the handover after scanning the tenant's pass: keys, meters, a photo
 * of the tenant receiving the key and photos of the premises. The tenant then accepts it.
 */
export async function offerHandover(
  claims: SessionClaims,
  key: HandoverKey,
  input: {
    recipientName: string;
    keys?: string | undefined;
    electricityReading?: string | undefined;
    waterReading?: string | undefined;
    notes?: string | undefined;
    recipientPhoto: HandoverPhotoInput;
    photos: HandoverPhotoInput[];
  },
) {
  if (!claims.organizationId || !hasPermission(claims, 'reservation.handover')) fail('forbidden');
  const recipientName = input.recipientName.trim().slice(0, 120);
  if (recipientName.length < 2 || input.photos.length > HANDOVER_PHOTOS_MAX) {
    leaseBookingFail('handover_invalid');
  }
  const [recipient] = await brandHandoverPhotos([input.recipientPhoto]);
  const photos = await brandHandoverPhotos(input.photos);
  const text = (value: string | undefined, max: number) => value?.trim().slice(0, max) || null;

  return withinViewerTenant(claims, async (tx) => {
    const reservationId = await reservationIdForKey(tx, key);
    const row = await loadForOwner(tx, claims, reservationId);
    assertOpen(row);
    const existing = row.lifecycle.handover;
    if (!row.lifecycle.tenantSignature || (existing && existing.status !== 'awaiting_tenant')) {
      fail('reservation_not_ready');
    }
    const now = new Date();
    const at = now.toISOString();
    const byName = await viewerName(tx, claims.sub);
    const [evidence] = await tx
      .insert(workflowEvents)
      .values({
        organizationId: row.orgId,
        actorUserId: claims.sub,
        resourceType: 'reservation_handover',
        resourceId: row.id,
        eventType: 'reservation.handover_evidence',
        metadata: {
          referenceCode: row.snapshot.referenceCode,
          recipientPhoto: recipient!.data,
          photos: photos.map((photo) => photo.data),
        },
      })
      .returning({ id: workflowEvents.id });
    const lifecycle: ReservationLifecycle = {
      ...row.lifecycle,
      handover: {
        at,
        on: muscatDate(now),
        byName,
        byUserId: claims.sub,
        recipientName,
        keys: text(input.keys, 200),
        electricityReading: text(input.electricityReading, 40),
        waterReading: text(input.waterReading, 40),
        notes: text(input.notes, 1000),
        method: 'scan',
        status: 'awaiting_tenant',
        evidenceEventId: evidence!.id,
        recipientPhoto: recipient!.meta,
        photos: photos.map((photo) => photo.meta),
        acceptedAt: null,
        defectsUntil: null,
        defects: null,
      },
    };
    await saveLifecycle(tx, row, lifecycle);
    await logEvent(tx, {
      orgId: row.orgId,
      actorUserId: claims.sub,
      reservationId: row.id,
      eventType: 'reservation.handover_offered',
      status: row.status,
      metadata: {
        referenceCode: row.snapshot.referenceCode,
        byName,
        recipientName,
        photos: photos.length,
        evidenceEventId: evidence!.id,
      },
    });
    await tx.insert(outboxEvents).values({
      organizationId: row.orgId,
      topic: 'reservation.handover_offered',
      aggregateType: 'reservation',
      aggregateId: row.id,
      payload: { referenceCode: row.snapshot.referenceCode, offeredAt: at },
    });
    return { referenceCode: row.snapshot.referenceCode, offeredAt: at };
  });
}

/** The tenant accepts the premises: the handover is complete and the defects window opens. */
export async function acceptHandover(claims: SessionClaims, referenceCode: string) {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    const current = await customerReservation(transaction, claims.sub, referenceCode);
    const handover = current.lifecycle.handover;
    if (handover?.status === 'accepted') {
      return {
        acceptedAt: handover.acceptedAt ?? handover.at,
        defectsUntil: handover.defectsUntil,
      };
    }
    if (!handover || handover.status !== 'awaiting_tenant') leaseBookingFail('not_ready');
    const now = new Date();
    const acceptedAt = now.toISOString();
    const defectsUntil = new Date(
      now.getTime() + HANDOVER_DEFECTS_HOURS * 60 * 60 * 1000,
    ).toISOString();
    const orgId = current.match.organizationId;
    await saveLifecycle(
      transaction,
      { id: current.match.id, snapshot: current.snapshot },
      {
        ...current.lifecycle,
        handover: { ...handover, status: 'accepted', acceptedAt, defectsUntil },
      },
    );
    await logEvent(transaction, {
      orgId,
      actorUserId: claims.sub,
      reservationId: current.match.id,
      eventType: 'reservation.handed_over',
      status: current.status,
      metadata: {
        referenceCode: current.snapshot.referenceCode,
        method: 'scan',
        acceptedAt,
        recipientName: handover.recipientName,
      },
    });
    await transaction.insert(outboxEvents).values({
      organizationId: orgId,
      topic: 'reservation.handed_over',
      aggregateType: 'reservation',
      aggregateId: current.match.id,
      payload: { referenceCode: current.snapshot.referenceCode, acceptedAt, defectsUntil },
    });
    return { acceptedAt, defectsUntil };
  });
}

/** Within three hours of accepting, the tenant may attach photos of defects with a note. */
export async function reportHandoverDefects(
  claims: SessionClaims,
  referenceCode: string,
  input: { note?: string | undefined; photos: HandoverPhotoInput[] },
) {
  if (!input.photos.length || input.photos.length > HANDOVER_PHOTOS_MAX) {
    leaseBookingFail('invalid_file');
  }
  const photos = await brandHandoverPhotos(input.photos);
  const note = input.note?.trim().slice(0, 1000) || null;
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    const current = await customerReservation(transaction, claims.sub, referenceCode);
    const handover = current.lifecycle.handover;
    if (!handover || !handoverDefectsOpen(current.lifecycle)) {
      leaseBookingFail('handover_defects_closed');
    }
    const orgId = current.match.organizationId;
    const at = new Date().toISOString();
    const [evidence] = await transaction
      .insert(workflowEvents)
      .values({
        organizationId: orgId,
        actorUserId: claims.sub,
        resourceType: 'reservation_handover',
        resourceId: current.match.id,
        eventType: 'reservation.handover_defects',
        metadata: {
          referenceCode: current.snapshot.referenceCode,
          photos: photos.map((photo) => photo.data),
        },
      })
      .returning({ id: workflowEvents.id });
    await saveLifecycle(
      transaction,
      { id: current.match.id, snapshot: current.snapshot },
      {
        ...current.lifecycle,
        handover: {
          ...handover,
          defects: {
            at,
            note,
            evidenceEventId: evidence!.id,
            photos: photos.map((photo) => photo.meta),
          },
        },
      },
    );
    await logEvent(transaction, {
      orgId,
      actorUserId: claims.sub,
      reservationId: current.match.id,
      eventType: 'reservation.handover_defects_reported',
      status: current.status,
      metadata: {
        referenceCode: current.snapshot.referenceCode,
        photos: photos.length,
        evidenceEventId: evidence!.id,
      },
    });
    await transaction.insert(outboxEvents).values({
      organizationId: orgId,
      topic: 'reservation.handover_defects_reported',
      aggregateType: 'reservation',
      aggregateId: current.match.id,
      payload: { referenceCode: current.snapshot.referenceCode, at, photos: photos.length },
    });
    return { reportedAt: at };
  });
}

/** `handover-recipient`, `handover-<n>` (premises) or `defect-<n>` (tenant's defect photos). */
export const HANDOVER_PHOTO_FILE = /^(?:handover-recipient|handover-[0-5]|defect-[0-5])$/;

/** One stored handover photo as a data URL, read inside an organization-scoped transaction. */
export async function handoverPhotoDataUrl(
  tx: Tx,
  orgId: string,
  lifecycle: ReservationLifecycle,
  file: string,
): Promise<string | null> {
  const handover = lifecycle.handover;
  if (!handover || !HANDOVER_PHOTO_FILE.test(file)) return null;
  const defect = file.startsWith('defect-');
  const eventId = defect ? handover.defects?.evidenceEventId : handover.evidenceEventId;
  if (!eventId) return null;
  const path =
    file === 'handover-recipient'
      ? sql`${workflowEvents.metadata}->>'recipientPhoto'`
      : sql`${workflowEvents.metadata}->'photos'->>${sql.raw(String(Number(file.slice(file.lastIndexOf('-') + 1))))}`;
  return withElevatedRead(tx, async () => {
    const [row] = await tx
      .select({ value: sql<string | null>`${path}` })
      .from(workflowEvents)
      .where(and(eq(workflowEvents.id, eventId), eq(workflowEvents.organizationId, orgId)))
      .limit(1);
    return row?.value && HANDOVER_IMAGE.test(row.value) ? row.value : null;
  });
}

/** A handover photo for the tenant of the booking: the premises, themselves, and their defects. */
export async function readHandoverPhotoForTenant(
  claims: SessionClaims,
  referenceCode: string,
  file: string,
): Promise<{ mimeType: string; bytes: Buffer } | null> {
  const normalized = normalizeLeaseReference(referenceCode);
  if (!normalized || !HANDOVER_PHOTO_FILE.test(file)) return null;
  const { db } = getDatabase();
  const dataUrl = await db.transaction(async (transaction) => {
    const match = await findLeaseReservation(transaction, 'referenceCode', normalized);
    if (!match) return null;
    await assertBookingOwner(transaction, claims.sub, match.partyEmail);
    await applyOrgScope(transaction, { organizationId: match.organizationId, userId: claims.sub });
    return handoverPhotoDataUrl(
      transaction,
      match.organizationId,
      lifecycleOf(match.snapshot),
      file,
    );
  });
  const parsed = dataUrl ? DATA_URL.exec(dataUrl) : null;
  return parsed ? { mimeType: parsed[1]!, bytes: Buffer.from(parsed[2]!, 'base64') } : null;
}
