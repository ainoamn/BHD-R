import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import { outboxEvents, properties, reservations, units, users, workflowEvents } from '@bhd-r/db';
import {
  REQUIREMENT_FILE_MAX_CHARS,
  REQUIREMENT_FILE_TYPES,
  leaseJourneyPhase,
  lifecycleOf,
  type LeaseJourneyPhase,
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
  await lockKey(tx, reservationId);
  const ownerPartyId = ownerPartyScope(claims);
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

type OwnerRow = Awaited<ReturnType<typeof loadForOwner>>;

async function saveLifecycle(
  tx: Tx,
  row: { id: string; snapshot: LeaseBookingSnapshot },
  lifecycle: ReservationLifecycle,
  patch: { status?: 'converted'; convertedLeaseId?: string | null; expiresAt?: Date } = {},
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
    actorUserId: string;
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
  | { action: 'approve' }
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
  if (row.status === 'cancelled' || row.status === 'expired') fail('reservation_closed');
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
        const draft = row.lifecycle.contractDraft;
        if (!draft) fail('reservation_not_ready');
        const source = {
          type: 'lease_reservation',
          reservationId: row.id,
          referenceCode: row.snapshot.referenceCode,
        };
        let outcome: { contractId: string; contractReference: string };
        if (sale) {
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
        const lifecycle: ReservationLifecycle = {
          ...row.lifecycle,
          contract: {
            id: outcome.contractId,
            reference: outcome.contractReference,
            issuedAt: at,
            byName,
          },
        };
        await saveLifecycle(tx, row, lifecycle, { expiresAt: extendedHold(row.expiresAt) });
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
  return db.transaction(async (transaction) => {
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
    return { submitted: true as const, code: input.code };
  });
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
  const identity = file !== 'signature' && file !== 'contract-signature';
  if (identity && !hasPermission(claims, 'reservation.manage')) return null;
  const { db } = getDatabase();
  const dataUrl = await db.transaction(async (transaction) => {
    const match = await findLeaseReservation(transaction, 'id', reservationId);
    if (!match || match.organizationId !== claims.organizationId) return null;
    const ownerPartyId = ownerPartyScope(claims);
    if (ownerPartyId && match.ownerPartyId !== ownerPartyId) return null;
    const lifecycle = lifecycleOf(match.snapshot);
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
