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
import { elevatedTx, rowsOf } from '@/lib/elevated-db';
import { appLink, notifyByEmail, notifyInTx, queueBrandedEmail } from '@/lib/email-notify';
import { sendQueuedEmailsSoon } from '@/lib/email-outbox';
import { publicWebOrigin } from '@/lib/seo';
import {
  HANDOVER_DEFECTS_HOURS,
  REQUIREMENT_FILE_MAX_CHARS,
  REQUIREMENT_FILE_TYPES,
  chequeStatusesOf,
  handoverAwaitingTenant,
  handoverDefectsOpen,
  handoverDefectsUntilFrom,
  handoverHandlerSelfie,
  handoverLiveSelfie,
  handoverSelfieState,
  isBookingIdentityDocCode,
  leaseJourneyPhase,
  listBookingIdentityDocs,
  lifecycleOf,
  type BookingIdentityDocCode,
  type HandoverPhotoMeta,
  type LeaseJourneyPhase,
  type ReservationCancelReason,
  type ReservationChequeInstruction,
  type ReservationChequeSubmission,
  type ReservationLifecycle,
  type ReservationRequirement,
  type ReservationSaleDraft,
} from '@/lib/lease-reservation-lifecycle';
import {
  computeLeaseTerms,
  minorDigitsFor,
  type LeaseTermsDraft,
} from '@/lib/lease-terms';
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
import type { ReservationParty } from '@/lib/reservation-party';

/** Drop only the party copies the owner rejected so locked ones stay on the booking. */
function stripRejectedPartyDocumentCopies(
  party: ReservationParty | undefined,
  rejected: ReadonlySet<string>,
): ReservationParty | undefined {
  if (!party) return undefined;
  if (party.entityType === 'person' && party.person) {
    const person = { ...party.person };
    if (rejected.has('civil_id_copy')) delete person.civilIdCopy;
    if (rejected.has('passport_copy')) delete person.passportCopy;
    return { ...party, person, company: null };
  }
  if (party.entityType === 'company' && party.company) {
    const company = { ...party.company };
    if (rejected.has('cr_copy')) delete company.crCopy;
    return {
      ...party,
      person: null,
      company: {
        ...company,
        signatories: company.signatories.map((row) => {
          // Signatory copies are not selectable yet — keep them when CR is locked, strip with CR.
          if (!rejected.has('cr_copy')) return row;
          const { civilIdCopy: _sc, passportCopy: _sp, ...rest } = row;
          return rest;
        }),
      },
    };
  }
  return party;
}

const BOOKING_RETURN_PHASES = new Set<LeaseJourneyPhase>([
  'awaiting_owner_approval',
  'awaiting_contract_draft',
  'awaiting_documents',
  'awaiting_documents_review',
  'awaiting_contract_approval',
]);

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
    status?: 'converted' | 'cancelled' | 'confirmed';
    convertedLeaseId?: string | null;
    expiresAt?: Date;
    /** Extra terms_snapshot fields (party updates, etc.). */
    snapshot?: Partial<LeaseBookingSnapshot>;
    /** Drop the booking e-signature so the client must sign again. */
    clearEsign?: boolean;
  } = {},
) {
  const nextSnapshot: LeaseBookingSnapshot = {
    ...row.snapshot,
    ...patch.snapshot,
    lifecycle,
  };
  if (patch.clearEsign) {
    delete (nextSnapshot as { esign?: unknown }).esign;
  }
  await tx
    .update(reservations)
    .set({
      termsSnapshot: nextSnapshot,
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.convertedLeaseId !== undefined ? { convertedLeaseId: patch.convertedLeaseId } : {}),
      ...(patch.expiresAt ? { expiresAt: patch.expiresAt } : {}),
      updatedAt: new Date(),
    })
    .where(eq(reservations.id, row.id));
  row.snapshot = nextSnapshot;
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
      /** rejected = ask for a replacement; cancel_booking = void the booking. */
      decision: 'verified' | 'rejected' | 'cancel_booking';
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
  | {
      action: 'add_requirements';
      requirements: RequirementInput[];
    }
  | {
      action: 'review_cheque';
      key: string;
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
    }
  | {
      action: 'save_municipal_registration';
      formNo: string;
      contractNo: string;
      electricityReading: string;
      waterReading: string;
      electricityReadingPhoto: string;
      waterReadingPhoto: string;
    }
  | { action: 'restore_reservation'; note: string }
  | { action: 'return_booking_docs'; note: string; rejected: string[] }
  | { action: 'cancel_reservation'; note: string };

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

/** Seed per-installment cheque rows the tenant must complete on the confirmed page. */
function buildChequeInstructions(
  draft: LeaseTermsDraft,
  currency: string,
  deferUntilHandover: ReadonlyArray<'meters' | 'handoverOn'> = [],
): {
  payableTo: string | null;
  bankName: string | null;
  rentBankAccountId: string | null;
  instructions: ReservationChequeInstruction[];
} {
  const computed = computeLeaseTerms(draft, currency, minorDigitsFor(currency), {
    deferUntilHandover,
  });
  if (!computed.ok || computed.terms.paymentMethod !== 'cheque') {
    return {
      payableTo: null,
      bankName: null,
      rentBankAccountId: draft.rentBankAccountId?.trim().slice(0, 64) || null,
      instructions: [],
    };
  }
  const terms = computed.terms;
  const instructions: ReservationChequeInstruction[] = [];
  for (const [index, row] of terms.schedule.entries()) {
    instructions.push({
      key: `rent-${index}`,
      kind: 'rent',
      labelAr: `شيك إيجار #${index + 1}`,
      labelEn: `Rent cheque #${index + 1}`,
      dueOn: row.dueOn,
      amountMinor: row.totalMinor,
      currency,
      suggestedChequeNumber: row.chequeNumber,
    });
  }
  for (const [index, row] of terms.vatCheques.entries()) {
    instructions.push({
      key: `vat-${index}`,
      kind: 'vat',
      labelAr: `شيك ضريبة #${index + 1}`,
      labelEn: `VAT cheque #${index + 1}`,
      dueOn: row.dueOn,
      amountMinor: row.amountMinor,
      currency,
      suggestedChequeNumber: row.chequeNumber,
    });
  }
  terms.depositItems.forEach((item, index) => {
    if (item.method !== 'cheque') return;
    instructions.push({
      key: `deposit-${index}`,
      kind: 'deposit',
      labelAr: `شيك تأمين #${index + 1}`,
      labelEn: `Deposit cheque #${index + 1}`,
      dueOn: item.dueOn,
      amountMinor: item.amountMinor,
      currency,
      suggestedChequeNumber: item.reference,
    });
  });
  return {
    payableTo: terms.chequeAccountName,
    bankName: terms.chequeBankName,
    rentBankAccountId: terms.rentBankAccountId,
    instructions,
  };
}

/** Keep approved/submitted cheque rows when the schedule keys still match. */
function mergeChequeSubmissions(
  instructions: ReservationChequeInstruction[],
  existing: ReservationChequeSubmission[] | undefined,
): ReservationChequeSubmission[] {
  if (!instructions.length || !existing?.length) return [];
  const allowed = new Set(instructions.map((row) => row.key));
  return existing.filter((row) => allowed.has(row.key));
}

/** Copy tenant cheque numbers/banks onto the lease draft before the contract is issued. */
function applyChequeSubmissionsToLease(
  lease: ManualLeaseInput,
  submissions: ReservationChequeSubmission[],
): ManualLeaseInput {
  if (!submissions.length) return lease;
  const byKey = new Map(submissions.map((row) => [row.key, row]));
  const terms: LeaseTermsDraft = {
    ...lease.terms,
    schedule: lease.terms.schedule.map((row, index) => {
      const submitted = byKey.get(`rent-${index}`);
      if (!submitted) return row;
      return {
        ...row,
        chequeNumber: submitted.chequeNumber,
        bankName: submitted.bankName,
      };
    }),
    vatChequeNumbers: (lease.terms.vatChequeNumbers ?? []).map((value, index) => {
      const submitted = byKey.get(`vat-${index}`);
      return submitted?.chequeNumber ?? value;
    }),
    depositItems: lease.terms.depositItems.map((item, index) => {
      if (item.method !== 'cheque') return item;
      const submitted = byKey.get(`deposit-${index}`);
      if (!submitted) return item;
      return {
        ...item,
        reference: submitted.chequeNumber,
        bankName: submitted.bankName,
      };
    }),
  };
  const first = submissions[0];
  if (first && !terms.chequeBankName) terms.chequeBankName = first.bankName;
  return { ...lease, terms };
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
    const withCheques = applyChequeSubmissionsToLease(
      {
        ...lease,
        unitId: row.unitId,
        tenant: { ...lease.tenant, partyId: row.tenantPartyId },
      },
      lifecycle.chequeSubmissions ?? [],
    );
    const deferUntilHandover = lifecycle.autoFlow?.deferUntilHandover;
    outcome = await issueManualLeaseInTx(tx, claims, row.propertyId, withCheques, {
      source,
      awaitCounterparty: true,
      ...(deferUntilHandover?.length ? { deferUntilHandover } : {}),
    });
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
  await notifyInTx(tx, {
    orgId: row.orgId,
    aggregateType: 'reservation',
    aggregateId: row.id,
    audience: { parties: [row.tenantPartyId] },
    content: () => ({
      tone: 'alert',
      subject: `أُلغي حجزك ${row.snapshot.referenceCode ?? ''}`.trim(),
      title: 'أُلغي الحجز',
      intro:
        input.note ??
        'أُلغي حجزك لأن متطلباته لم تكتمل في الوقت المحدد. يسعدنا أن تحجز من جديد متى شئت.',
      details: [
        ...(row.snapshot.referenceCode
          ? [{ label: 'رقم الحجز', value: row.snapshot.referenceCode }]
          : []),
        { label: 'الحالة', value: 'ملغى' },
      ],
      cta: { label: 'تصفّح العقارات المتاحة', url: appLink('/ar') },
    }),
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
  await notifyReservationStep(reservationId, input);
  if (!AUTOMATION_TRIGGERS.has(input.action)) return result;
  if (options.defer && input.action === 'review_document') {
    options.defer(() => runReservationAutomation(reservationId, claims.sub));
    return { ...result, automationPending: true };
  }
  const phase = await runReservationAutomation(reservationId, claims.sub);
  return phase ? { ...result, phase } : result;
}

type ReservationFacts = {
  organizationId: string;
  tenantPartyId: string;
  propertyId: string;
  propertyName: string | null;
  referenceCode: string | null;
};

async function reservationFacts(reservationId: string): Promise<ReservationFacts | null> {
  try {
    return await elevatedTx(async (tx) => {
      const [row] = rowsOf<ReservationFacts>(
        await tx.execute(sql`select r.organization_id as "organizationId",
            r.tenant_party_id as "tenantPartyId", u.property_id as "propertyId",
            p.name_ar as "propertyName", r.terms_snapshot->>'referenceCode' as "referenceCode"
          from reservations r join units u on u.id = r.unit_id
          join properties p on p.id = u.property_id
          where r.id = ${reservationId}::uuid limit 1`),
      );
      return row ?? null;
    });
  } catch {
    return null;
  }
}

/** What the tenant or buyer hears after each owner step on their website booking. */
function ownerStepNotice(
  input: ReservationOwnerAction,
): { subject: string; title: string; line: string } | null {
  switch (input.action) {
    case 'confirm_payment':
      return {
        subject: '💳 تأكّد استلام دفعة حجزك',
        title: 'وصلت دفعتك بسلام',
        line: 'أكّد المالك استلام دفعة الحجز، والوحدة محجوزة باسمك الآن. الخطوة التالية: تجهيز العقد والمستندات.',
      };
    case 'reject_payment':
      return {
        subject: '⚠️ لم يتأكد استلام دفعة حجزك',
        title: 'نحتاج نظرة ثانية على الدفعة',
        line: `لم يتمكن المالك من تأكيد استلام الدفعة. السبب: «${input.note}». راجع الحجز وتواصل معه إن لزم.`,
      };
    case 'approve':
      return {
        subject: '✅ وافق المالك على حجزك',
        title: 'خبر سعيد: حجزك مقبول!',
        line: 'وافق المالك على حجزك، وسنخبرك بكل خطوة قادمة أولاً بأول.',
      };
    case 'save_contract':
      return {
        subject: '📋 جهّز المالك عقدك وطلب بعض المستندات',
        title: 'العقد يُجهَّز، وبقيت مستنداتك',
        line: 'جهّز المالك مسودة العقد وحدّد المستندات المطلوبة. ارفعها من صفحة الحجز ليُكمل الإجراءات.',
      };
    case 'verify_document': {
      if (input.decision === 'cancel_booking') {
        return {
          subject: '⛔ أُلغي حجزك بسبب المستندات',
          title: 'أُلغي الحجز',
          line: `بعد المراجعة تبيّن أن أحد المستندات يخالف الاشتراطات${input.note ? `: «${input.note}»` : ''}. أُلغي الحجز كما نُبّهت عند الاعتماد الإلكتروني.`,
        };
      }
      const ok = input.decision === 'verified';
      return {
        subject: ok ? '📄 اعتُمد أحد مستنداتك' : '📄 أحد مستنداتك يحتاج تعديلاً',
        title: ok ? 'مستندك مقبول، أحسنت!' : 'مستند يحتاج إعادة رفع',
        line: ok
          ? 'راجع المالك المستند واعتمده.'
          : `راجع المالك المستند وطلب استبداله${input.note ? `: «${input.note}»` : ''}. ارفع نسخة أوضح من صفحة الحجز.`,
      };
    }
    case 'review_document': {
      const ok = input.decision === 'approved';
      return {
        subject: ok ? '📄 اعتُمد أحد مستنداتك' : '📄 أحد مستنداتك يحتاج تعديلاً',
        title: ok ? 'مستندك مقبول، أحسنت!' : 'مستند يحتاج إعادة رفع',
        line: ok
          ? 'راجع المالك المستند واعتمده.'
          : `راجع المالك المستند وطلب استبداله${input.note ? `: «${input.note}»` : ''}. ارفع نسخة أوضح من صفحة الحجز.`,
      };
    }
    case 'add_requirements': {
      const labels = input.requirements.map((item) => item.labelAr).filter(Boolean);
      const list = labels.slice(0, 4).join('، ');
      return {
        subject: '📎 طلب المالك مستندات إضافية',
        title: 'مستندات جديدة مطلوبة منك',
        line: list
          ? `طلب المالك مستندات إضافية: ${list}${labels.length > 4 ? '…' : ''}. ارفعها من صفحة الحجز.`
          : 'طلب المالك مستندات إضافية. ارفعها من صفحة الحجز.',
      };
    }
    case 'record_handover':
      return {
        subject: '🗝️ سُلّم العقار — أهلاً بك في بيتك الجديد',
        title: 'المفتاح صار في يدك!',
        line: `سُجّل تسليم العقار بتاريخ ${input.on.split('-').reverse().join('/')}. نتمنى لك إقامة سعيدة، ونحن هنا لأي طلب صيانة أو استفسار.`,
      };
    case 'restore_reservation':
      return {
        subject: '♻️ أُعيد فتح حجزك',
        title: 'حجزك عاد نشطاً',
        line: `استرجع المالك حجزك وأعاد فتحه${input.note ? `: «${input.note}»` : ''}. تابع صفحة الحجز لرفع أي مستند مطلوب.`,
      };
    case 'return_booking_docs':
      return {
        subject: '📎 أعد المالك مستندات حجزك للتعديل',
        title: 'مطلوب تعديل مستندات الحجز',
        line: `راجع المالك مستندات الحجز وطلب تعديلها: «${input.note}». أعد رفع المستندات ووقّع اتفاقية الحجز من جديد من صفحة الحجز (العربون محفوظ).`,
      };
    case 'cancel_reservation':
      return {
        subject: '⛔ أُلغي حجزك',
        title: 'أُلغي الحجز',
        line: `أُلغي الحجز من قبل المالك${input.note ? `: «${input.note}»` : ''}.`,
      };
    default:
      return null;
  }
}

async function notifyReservationStep(reservationId: string, input: ReservationOwnerAction) {
  const notice = ownerStepNotice(input);
  if (!notice) return;
  const facts = await reservationFacts(reservationId);
  if (!facts) return;
  await notifyByEmail({
    orgId: facts.organizationId,
    aggregateType: 'reservation',
    aggregateId: reservationId,
    audience: { parties: [facts.tenantPartyId] },
    content: () => ({
      tone: input.action === 'record_handover' ? 'booking' : 'contract',
      subject: `${notice.subject}${facts.referenceCode ? ` — ${facts.referenceCode}` : ''}`,
      title: notice.title,
      intro: notice.line,
      details: [
        ...(facts.referenceCode ? [{ label: 'رقم الحجز', value: facts.referenceCode }] : []),
        ...(facts.propertyName ? [{ label: 'العقار', value: facts.propertyName }] : []),
      ],
      cta: {
        label: 'متابعة الحجز',
        url: facts.referenceCode
          ? appLink(`/ar/book/confirmed?ref=${encodeURIComponent(facts.referenceCode)}`)
          : appLink('/ar/tenant/reservations'),
      },
    }),
  });
}

/** The owner's people hear when the customer moves the booking forward on their side. */
async function notifyOwnersOfCustomerStep(
  reservationId: string,
  notice: { subject: string; title: string; line: string },
) {
  const facts = await reservationFacts(reservationId);
  if (!facts) return;
  await notifyByEmail({
    orgId: facts.organizationId,
    aggregateType: 'reservation',
    aggregateId: reservationId,
    audience: { managersOf: { orgId: facts.organizationId, propertyId: facts.propertyId } },
    content: () => ({
      tone: 'booking',
      subject: `${notice.subject}${facts.referenceCode ? ` — ${facts.referenceCode}` : ''}`,
      title: notice.title,
      intro: notice.line,
      details: [
        ...(facts.referenceCode ? [{ label: 'رقم الحجز', value: facts.referenceCode }] : []),
        ...(facts.propertyName ? [{ label: 'العقار', value: facts.propertyName }] : []),
      ],
      cta: { label: 'فتح الحجز', url: appLink(`/ar/owner/bookings/${reservationId}`) },
    }),
  });
}

/** Owner steps after which the system may take the next one on the owner's behalf. */
const AUTOMATION_TRIGGERS = new Set<ReservationOwnerAction['action']>([
  'confirm_payment',
  'save_contract',
  'review_document',
  'review_cheque',
]);

async function ownerActionInTx(
  claims: SessionClaims,
  reservationId: string,
  input: ReservationOwnerAction,
): Promise<{ phase: LeaseJourneyPhase; contractId?: string; contractReference?: string }> {
  if (!hasPermission(claims, 'reservation.manage')) fail('forbidden');
  return withinViewerTenant(claims, async (tx) => {
    const row = await loadForOwner(tx, claims, reservationId);
    if (input.action !== 'restore_reservation') assertOpen(row);
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
      case 'restore_reservation': {
        const previous = row.lifecycle.cancellation;
        if (row.status !== 'cancelled' || !previous) fail('reservation_not_ready');
        if (row.lifecycle.handover) fail('reservation_not_ready');
        const note = input.note.trim().slice(0, 1000);
        if (note.length < 2) fail('invalid_body');
        const [conflict] = await tx
          .select({ id: reservations.id })
          .from(reservations)
          .where(
            and(
              eq(reservations.organizationId, row.orgId),
              eq(reservations.unitId, row.unitId),
              inArray(reservations.status, ['pending', 'confirmed']),
              sql`${reservations.id} <> ${row.id}`,
            ),
          )
          .limit(1);
        if (conflict) fail('unit_already_reserved');

        let next: ReservationLifecycle = { ...row.lifecycle };
        delete next.cancellation;
        if (next.contract) {
          const [contractRow] = await tx
            .select({ status: contracts.status })
            .from(contracts)
            .where(and(eq(contracts.id, next.contract.id), eq(contracts.organizationId, row.orgId)))
            .limit(1);
          if (
            !contractRow ||
            contractRow.status === 'void' ||
            contractRow.status === 'terminated'
          ) {
            delete next.contract;
            delete next.tenantSignature;
          }
        }
        next = {
          ...next,
          customerDocumentsSentAt: null,
          restoration: {
            at,
            byName,
            note,
            previousCancellation: {
              at: previous.at,
              byName: previous.byName,
              reason: previous.reason,
              note: previous.note,
              ...(previous.code ? { code: previous.code } : {}),
            },
          },
        };
        await saveLifecycle(tx, row, next, {
          status: 'confirmed',
          expiresAt: extendedHold(row.expiresAt),
        });
        await event('reservation.restored', { note, previousReason: previous.reason }, 'confirmed');
        break;
      }

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
                autoApproved: false,
                verifiedAt: null,
                verifiedByName: null,
                reviewedAt: at,
                reviewedByName: byName,
              }
            : item,
        );
        // Default reject asks for a clearer file. Cancelling the booking is an explicit choice.
        if (input.decision === 'cancel_booking') {
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
        await saveLifecycle(tx, row, {
          ...row.lifecycle,
          requirements: next,
          customerDocumentsSentAt: null,
        });
        await event('reservation.document_rejected', { code: input.code, replacement: true });
        break;
      }

      case 'approve': {
        if (row.lifecycle.approval) break;
        if (phase !== 'awaiting_owner_approval' || row.status !== 'confirmed') {
          fail('reservation_not_ready');
        }
        const priorReturn = row.lifecycle.bookingDocsReturn;
        const lifecycle: ReservationLifecycle = {
          ...row.lifecycle,
          approval: { at, byUserId: claims.sub, byName },
          ...(priorReturn && !priorReturn.resolvedAt
            ? { bookingDocsReturn: { ...priorReturn, resolvedAt: at } }
            : {}),
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

      case 'return_booking_docs': {
        if (!BOOKING_RETURN_PHASES.has(phase) || row.lifecycle.contract) {
          fail('reservation_not_ready');
        }
        const note = input.note.trim().slice(0, 500);
        if (note.length < 2) fail('invalid_body');
        const available = listBookingIdentityDocs({
          hasEsign: Boolean(row.snapshot.esign?.completed),
          party: row.snapshot.party ?? null,
        });
        if (!available.length) fail('invalid_body');
        const availableSet = new Set(available);
        const rejected = [
          ...new Set(
            (input.rejected ?? [])
              .map((code) => code.trim())
              .filter(isBookingIdentityDocCode)
              .filter((code) => availableSet.has(code)),
          ),
        ] as BookingIdentityDocCode[];
        if (!rejected.length) fail('invalid_body');
        const rejectedSet = new Set<string>(rejected);
        const locked = available.filter((code) => !rejectedSet.has(code));
        const partyDocRejected =
          rejectedSet.has('civil_id_copy') ||
          rejectedSet.has('passport_copy') ||
          rejectedSet.has('cr_copy');
        const strippedParty = partyDocRejected
          ? stripRejectedPartyDocumentCopies(row.snapshot.party, rejectedSet)
          : undefined;
        const evidenceEventId = row.snapshot.esign?.evidenceEventId ?? null;
        const nextLifecycle: ReservationLifecycle = {
          bookingDocsReturn: {
            at,
            byName,
            note,
            resolvedAt: null,
            rejected,
            locked,
            evidenceEventId,
          },
          ...(row.lifecycle.paymentReview ? { paymentReview: row.lifecycle.paymentReview } : {}),
          ...(row.lifecycle.restoration ? { restoration: row.lifecycle.restoration } : {}),
        };
        await saveLifecycle(tx, row, nextLifecycle, {
          expiresAt: extendedHold(row.expiresAt),
          clearEsign: true,
          ...(strippedParty ? { snapshot: { party: strippedParty } } : {}),
        });
        await event('reservation.booking_docs_returned', { note, rejected, locked });
        break;
      }

      case 'cancel_reservation': {
        if (
          (!BOOKING_RETURN_PHASES.has(phase) && phase !== 'awaiting_tenant_signature') ||
          row.lifecycle.handover
        ) {
          fail('reservation_not_ready');
        }
        const note = input.note.trim().slice(0, 500);
        if (note.length < 2) fail('invalid_body');
        await cancelReservationInTx(tx, row, row.lifecycle, {
          actorUserId: claims.sub,
          byName,
          reason: 'documents_invalid',
          note,
        });
        break;
      }

      case 'save_contract': {
        if (!hasPermission(claims, 'contract.create')) fail('forbidden');
        if (!row.lifecycle.approval || row.lifecycle.contract) fail('reservation_not_ready');
        const { policy: approvalPolicy } = await resolveApprovalPolicy(
          tx,
          row.orgId,
          row.propertyId,
          sale ? 'sale' : 'rent',
        );
        const deferUntilHandover = approvalPolicy.deferUntilHandover;
        let draft: NonNullable<ReservationLifecycle['contractDraft']>;
        if (sale) {
          if (!input.sale) fail('invalid_body');
          if (decimalToMinor(input.sale.amount, row.currency) <= 0n) fail('invalid_amount');
          if (!/^\d{4}-\d{2}-\d{2}$/.test(input.sale.signedOn)) fail('invalid_dates');
          draft = { savedAt: at, byName, sale: input.sale };
        } else {
          if (!input.lease) fail('invalid_body');
          assertLeaseTermsValid(input.lease.terms, row.currency, { deferUntilHandover });
          if (
            input.lease.terms.paymentMethod === 'cheque' &&
            !(input.lease.terms.chequeAccountName?.trim())
          ) {
            fail('invalid_body');
          }
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
        const chequeSeed =
          !sale && input.lease
            ? buildChequeInstructions(input.lease.terms, row.currency, deferUntilHandover)
            : {
                payableTo: null,
                bankName: null,
                rentBankAccountId: null,
                instructions: [] as ReservationChequeInstruction[],
              };
        const chequeSubmissions = mergeChequeSubmissions(
          chequeSeed.instructions,
          row.lifecycle.chequeSubmissions,
        );
        await saveLifecycle(tx, row, {
          ...row.lifecycle,
          contractDraft: draft,
          requirements,
          autoFlow: {
            contractAuto: approvalPolicy.contract === 'auto',
            deferUntilHandover,
            requireTenantAttestation: approvalPolicy.requireTenantAttestation,
          },
          chequePayableTo: chequeSeed.payableTo,
          chequeBankName: chequeSeed.bankName,
          rentBankAccountId: chequeSeed.rentBankAccountId,
          chequeInstructions: chequeSeed.instructions,
          chequeSubmissions,
        });
        await event('reservation.contract_prepared', {
          requirements: requirements.map((item) => item.code),
          cheques: chequeSeed.instructions.map((item) => item.key),
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
        await saveLifecycle(tx, row, {
          ...row.lifecycle,
          requirements: next,
          ...(input.decision === 'rejected' ? { customerDocumentsSentAt: null } : {}),
        });
        await event(`reservation.document_${input.decision}`, { code: input.code });
        break;
      }

      case 'add_requirements': {
        if (row.lifecycle.contract) fail('reservation_not_ready');
        if (
          phase !== 'awaiting_contract_draft' &&
          phase !== 'awaiting_documents' &&
          phase !== 'awaiting_documents_review' &&
          phase !== 'awaiting_contract_approval'
        ) {
          fail('reservation_not_ready');
        }
        const existing = row.lifecycle.requirements ?? [];
        const existingCodes = new Set(existing.map((item) => item.code));
        const additions = input.requirements
          .map((item) => ({
            code: item.code.trim(),
            labelAr: item.labelAr.trim().slice(0, 120),
            labelEn: (item.labelEn.trim() || item.labelAr).trim().slice(0, 120),
          }))
          .filter(
            (item) =>
              /^[a-z0-9_]{2,40}$/.test(item.code) &&
              item.labelAr.length >= 2 &&
              !existingCodes.has(item.code),
          );
        if (!additions.length) fail('invalid_body');
        if (existing.length + additions.length > MAX_REQUIREMENTS) fail('requirements_invalid');
        const seen = new Set<string>();
        for (const item of additions) {
          if (seen.has(item.code)) fail('requirements_invalid');
          seen.add(item.code);
        }
        const next: ReservationRequirement[] = [
          ...existing,
          ...additions.map((item) => ({
            code: item.code,
            labelAr: item.labelAr,
            labelEn: item.labelEn,
            status: 'pending' as const,
          })),
        ];
        await saveLifecycle(tx, row, {
          ...row.lifecycle,
          requirements: next,
          customerDocumentsSentAt: null,
        });
        await event('reservation.requirements_added', {
          codes: additions.map((item) => item.code),
        });
        break;
      }

      case 'review_cheque': {
        if (row.lifecycle.contract) fail('reservation_not_ready');
        const instructions = row.lifecycle.chequeInstructions ?? [];
        if (!instructions.some((item) => item.key === input.key)) fail('requirement_not_found');
        const submissions = row.lifecycle.chequeSubmissions ?? [];
        const target = submissions.find((item) => item.key === input.key);
        if (!target?.file) fail('reservation_not_ready');
        const note = input.note?.trim().slice(0, 500) || null;
        if (input.decision === 'rejected' && !note) fail('invalid_body');
        const next = submissions.map((item) =>
          item.key === input.key
            ? {
                ...item,
                status: input.decision,
                note: input.decision === 'rejected' ? note : null,
                reviewedAt: at,
                reviewedByName: byName,
              }
            : item,
        );
        await saveLifecycle(tx, row, {
          ...row.lifecycle,
          chequeSubmissions: next,
          ...(input.decision === 'rejected' ? { customerDocumentsSentAt: null } : {}),
        });
        await event(`reservation.cheque_${input.decision}`, { key: input.key });
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
        // Meter readings are completed by admin after handover — not required at the door.
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

      case 'save_municipal_registration': {
        if (row.snapshot.mode === 'sale') fail('reservation_not_ready');
        const handover = row.lifecycle.handover;
        // Effective once filed by staff (including legacy awaiting_tenant records).
        if (!handover) fail('reservation_not_ready');
        if (handover.status && handover.status !== 'accepted' && handover.status !== 'awaiting_tenant') {
          fail('reservation_not_ready');
        }
        const formNo = input.formNo.trim().slice(0, 80);
        const contractNo = input.contractNo.trim().slice(0, 80);
        const electricityReading = input.electricityReading.trim().slice(0, 40);
        const waterReading = input.waterReading.trim().slice(0, 40);
        const electricityReadingPhoto = input.electricityReadingPhoto.trim();
        const waterReadingPhoto = input.waterReadingPhoto.trim();
        if (!formNo || !contractNo) fail('municipal_registration_invalid');
        if (
          !electricityReading ||
          !waterReading ||
          !electricityReadingPhoto.startsWith('data:image/') ||
          !waterReadingPhoto.startsWith('data:image/')
        ) {
          fail('meters_required');
        }
        const registration = {
          formNo,
          contractNo,
          at,
          byName,
        };
        const draft = row.lifecycle.contractDraft;
        let nextDraft = draft;
        if (draft?.lease && typeof draft.lease === 'object') {
          const lease = draft.lease as { terms?: Record<string, unknown> };
          const terms =
            lease.terms && typeof lease.terms === 'object' ? { ...lease.terms } : {};
          terms.municipalFormNo = formNo;
          terms.municipalContractNo = contractNo;
          terms.electricityReading = electricityReading;
          terms.waterReading = waterReading;
          terms.electricityReadingPhoto = electricityReadingPhoto;
          terms.waterReadingPhoto = waterReadingPhoto;
          nextDraft = {
            ...draft,
            savedAt: at,
            byName,
            lease: { ...lease, terms },
          };
        } else {
          nextDraft = {
            savedAt: at,
            byName,
            lease: {
              terms: {
                municipalFormNo: formNo,
                municipalContractNo: contractNo,
                electricityReading,
                waterReading,
                electricityReadingPhoto,
                waterReadingPhoto,
              },
            },
          };
        }
        const lifecycle: ReservationLifecycle = {
          ...row.lifecycle,
          ...(nextDraft ? { contractDraft: nextDraft } : {}),
          municipalRegistration: registration,
          handover: {
            ...handover,
            electricityReading,
            waterReading,
          },
        };
        await saveLifecycle(tx, row, lifecycle);
        const contractId = row.lifecycle.contract?.id;
        if (contractId) {
          const [contract] = await tx
            .select({ payloadSnapshot: contracts.payloadSnapshot })
            .from(contracts)
            .where(and(eq(contracts.id, contractId), eq(contracts.organizationId, row.orgId)))
            .limit(1);
          if (contract?.payloadSnapshot && typeof contract.payloadSnapshot === 'object') {
            const payload = { ...(contract.payloadSnapshot as Record<string, unknown>) };
            const leaseTerms =
              payload.leaseTerms && typeof payload.leaseTerms === 'object'
                ? { ...(payload.leaseTerms as Record<string, unknown>) }
                : {};
            leaseTerms.municipalFormNo = formNo;
            leaseTerms.municipalContractNo = contractNo;
            leaseTerms.electricityReading = electricityReading;
            leaseTerms.waterReading = waterReading;
            leaseTerms.electricityReadingPhoto = electricityReadingPhoto;
            leaseTerms.waterReadingPhoto = waterReadingPhoto;
            payload.leaseTerms = leaseTerms;
            await tx
              .update(contracts)
              .set({ payloadSnapshot: payload, updatedAt: new Date(at) })
              .where(and(eq(contracts.id, contractId), eq(contracts.organizationId, row.orgId)));
          }
        }
        await event('reservation.municipal_registration_saved', {
          formNo,
          contractNo,
          electricityReading,
          waterReading,
        });
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
            mode: sql<string | null>`${reservations.termsSnapshot}->>'mode'`,
          })
          .from(reservations)
          .innerJoin(units, eq(units.id, reservations.unitId))
          .where(eq(reservations.id, reservationId))
          .limit(1),
      );
      if (!base || base.flow !== LEASE_BOOKING_FLOW) return null;
      const resolved = await resolveApprovalPolicy(
        tx,
        base.orgId,
        base.propertyId,
        base.mode === 'sale' ? 'sale' : 'rent',
      );
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

      const docsReturnOpen =
        Boolean(lifecycle.bookingDocsReturn) && !lifecycle.bookingDocsReturn?.resolvedAt;
      if (
        policy.booking === 'auto' &&
        row.status === 'confirmed' &&
        phase() === 'awaiting_owner_approval' &&
        !docsReturnOpen
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
        const submittedCheques = (lifecycle.chequeSubmissions ?? []).filter(
          (item) => item.status === 'submitted',
        );
        const autoApprovedCodes = new Set(submitted.map((item) => item.code));
        const autoApprovedChequeKeys = new Set(submittedCheques.map((item) => item.key));
        if (submitted.length || submittedCheques.length) {
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
            chequeSubmissions: (lifecycle.chequeSubmissions ?? []).map((item) =>
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
            cheques: submittedCheques.map((item) => item.key),
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
          // Keep docs/cheques as submitted so the owner still sees Accept/Reject.
          if (autoApprovedCodes.size || autoApprovedChequeKeys.size) {
            lifecycle = {
              ...lifecycle,
              requirements: (lifecycle.requirements ?? []).map((item) => {
                if (!autoApprovedCodes.has(item.code) || !item.autoApproved) return item;
                const {
                  autoApproved: _a,
                  reviewedAt: _r,
                  reviewedByName: _n,
                  ...rest
                } = item;
                return { ...rest, status: 'submitted' as const, note: null };
              }),
              chequeSubmissions: (lifecycle.chequeSubmissions ?? []).map((item) => {
                if (!autoApprovedChequeKeys.has(item.key) || !item.autoApproved) return item;
                const {
                  autoApproved: _a,
                  reviewedAt: _r,
                  reviewedByName: _n,
                  ...rest
                } = item;
                return { ...rest, status: 'submitted' as const, note: null };
              }),
            };
            await saveLifecycle(tx, row, lifecycle);
          }
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

function assertTenantAttested(lifecycle: ReservationLifecycle) {
  if (
    lifecycle.autoFlow?.requireTenantAttestation &&
    !lifecycle.tenantAttestation?.accepted
  ) {
    leaseBookingFail('attestation_required');
  }
}

/** Tenant confirms document accuracy and cancel-if-invalid responsibility. */
export async function attestReservationDocuments(
  claims: SessionClaims,
  referenceCode: string,
) {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    const current = await customerReservation(transaction, claims.sub, referenceCode);
    if (
      current.phase !== 'awaiting_documents' &&
      current.phase !== 'awaiting_documents_review' &&
      current.phase !== 'awaiting_contract_approval' &&
      current.phase !== 'awaiting_tenant_signature'
    ) {
      leaseBookingFail('not_ready');
    }
    if (current.lifecycle.tenantAttestation?.accepted) {
      return { attested: true as const, at: current.lifecycle.tenantAttestation.at };
    }
    if (!current.lifecycle.autoFlow?.requireTenantAttestation) {
      const at = new Date().toISOString();
      await saveLifecycle(
        transaction,
        { id: current.match.id, snapshot: current.snapshot },
        {
          ...current.lifecycle,
          tenantAttestation: { at, accepted: true },
        },
      );
      return { attested: true as const, at };
    }
    const at = new Date().toISOString();
    await saveLifecycle(
      transaction,
      { id: current.match.id, snapshot: current.snapshot },
      {
        ...current.lifecycle,
        tenantAttestation: { at, accepted: true },
      },
    );
    await logEvent(transaction, {
      orgId: current.match.organizationId,
      actorUserId: claims.sub,
      reservationId: current.match.id,
      eventType: 'reservation.tenant_attested',
      status: current.status,
      metadata: { referenceCode: current.snapshot.referenceCode },
    });
    return { attested: true as const, at };
  });
}

/**
 * Tenant finished uploading every required document/cheque and confirms send.
 * Attests (when required) and notifies the owner once — not on each file upload.
 */
export async function sendReservationDocumentsPackage(
  claims: SessionClaims,
  referenceCode: string,
  input: { accepted: true },
) {
  void input;
  const { db } = getDatabase();
  const result = await db.transaction(async (transaction) => {
    const current = await customerReservation(transaction, claims.sub, referenceCode);
    if (current.phase !== 'awaiting_documents' && current.phase !== 'awaiting_documents_review') {
      leaseBookingFail('not_ready');
    }
    const requirements = current.lifecycle.requirements ?? [];
    const chequeStatuses = chequeStatusesOf(current.lifecycle);
    const hasPackage = requirements.length > 0 || chequeStatuses.length > 0;
    if (!hasPackage) leaseBookingFail('not_ready');
    if (
      requirements.some((item) => item.status === 'pending' || item.status === 'rejected') ||
      chequeStatuses.some((status) => status === 'pending' || status === 'rejected')
    ) {
      leaseBookingFail('documents_package_incomplete');
    }
    const at = new Date().toISOString();
    if (current.lifecycle.customerDocumentsSentAt) {
      return {
        sent: true as const,
        at: current.lifecycle.customerDocumentsSentAt,
        reservationId: current.match.id,
        alreadySent: true as const,
      };
    }
    const attested =
      current.lifecycle.tenantAttestation?.accepted === true
        ? current.lifecycle.tenantAttestation
        : { at, accepted: true as const };
    await saveLifecycle(
      transaction,
      { id: current.match.id, snapshot: current.snapshot },
      {
        ...current.lifecycle,
        customerDocumentsSentAt: at,
        tenantAttestation: attested,
      },
    );
    await logEvent(transaction, {
      orgId: current.match.organizationId,
      actorUserId: claims.sub,
      reservationId: current.match.id,
      eventType: 'reservation.documents_package_sent',
      status: current.status,
      metadata: {
        referenceCode: current.snapshot.referenceCode,
        documents: requirements.length,
        cheques: chequeStatuses.length,
      },
    });
    return {
      sent: true as const,
      at,
      reservationId: current.match.id,
      alreadySent: false as const,
    };
  });
  if (!result.alreadySent) {
    await notifyOwnersOfCustomerStep(result.reservationId, {
      subject: '📎 العميل أرسل حزمة المستندات للمراجعة',
      title: 'مستندات الحجز جاهزة للمراجعة',
      line: 'أكمل العميل رفع كل المستندات والشيكات المطلوبة وأكّد إرسالها. راجعها واعتمدها ليمضي الحجز إلى العقد.',
    });
  }
  await runReservationAutomation(result.reservationId, claims.sub);
  return { sent: true as const, at: result.at };
}

/** Tenant submits one rent/VAT/deposit cheque (number + photo) from the confirmed page. */
export async function submitReservationCheque(
  claims: SessionClaims,
  referenceCode: string,
  input: {
    key: string;
    bankName: string;
    accountHolderName: string;
    accountNumber: string;
    chequeNumber: string;
    fileName: string;
    dataUrl: string;
  },
) {
  const parsed = DATA_URL.exec(input.dataUrl);
  if (
    !parsed ||
    !REQUIREMENT_FILE_TYPES.includes(parsed[1]!) ||
    input.dataUrl.length > REQUIREMENT_FILE_MAX_CHARS
  ) {
    leaseBookingFail('invalid_file');
  }
  const bankName = input.bankName.trim().slice(0, 160);
  const accountHolderName = input.accountHolderName.trim().slice(0, 160);
  const accountNumber = input.accountNumber.trim().replace(/\s+/g, '').slice(0, 64);
  const chequeNumber = input.chequeNumber.trim().slice(0, 80);
  if (
    bankName.length < 2 ||
    accountHolderName.length < 2 ||
    accountNumber.length < 4 ||
    chequeNumber.length < 1
  ) {
    leaseBookingFail('tenant_details_invalid');
  }
  const mime = parsed[1]!;
  const size = Math.floor((parsed[2]!.length * 3) / 4);
  const { db } = getDatabase();
  const reservationId = await db.transaction(async (transaction) => {
    const current = await customerReservation(transaction, claims.sub, referenceCode);
    if (current.phase !== 'awaiting_documents' && current.phase !== 'awaiting_documents_review') {
      leaseBookingFail('not_ready');
    }
    const instruction = (current.lifecycle.chequeInstructions ?? []).find(
      (item) => item.key === input.key,
    );
    if (!instruction) leaseBookingFail('requirement_not_found');
    const existing = (current.lifecycle.chequeSubmissions ?? []).find(
      (item) => item.key === input.key,
    );
    if (existing?.status === 'approved') leaseBookingFail('not_ready');

    const submittedAt = new Date().toISOString();
    const name = input.fileName.trim().slice(0, 120) || `${input.key}.jpg`;
    const [stored] = await transaction
      .insert(workflowEvents)
      .values({
        organizationId: current.match.organizationId,
        actorUserId: claims.sub,
        resourceType: 'reservation_cheque',
        resourceId: current.match.id,
        eventType: 'reservation.cheque_file',
        metadata: {
          referenceCode: current.snapshot.referenceCode,
          key: input.key,
          name,
          mime,
          size,
          bankName,
          accountHolderName,
          accountNumber,
          chequeNumber,
          dataUrl: input.dataUrl,
        },
      })
      .returning({ id: workflowEvents.id });

    const nextRow: ReservationChequeSubmission = {
      key: input.key,
      bankName,
      accountHolderName,
      accountNumber,
      chequeNumber,
      file: { eventId: stored!.id, name, mime, size, submittedAt },
      status: 'submitted',
      note: null,
    };
    const others = (current.lifecycle.chequeSubmissions ?? []).filter(
      (item) => item.key !== input.key,
    );
    await saveLifecycle(
      transaction,
      { id: current.match.id, snapshot: current.snapshot },
      { ...current.lifecycle, chequeSubmissions: [...others, nextRow] },
    );
    await logEvent(transaction, {
      orgId: current.match.organizationId,
      actorUserId: claims.sub,
      reservationId: current.match.id,
      eventType: 'reservation.cheque_submitted',
      status: current.status,
      metadata: {
        referenceCode: current.snapshot.referenceCode,
        key: input.key,
        chequeNumber,
      },
    });
    return current.match.id;
  });
  await runReservationAutomation(reservationId, claims.sub);
  return { submitted: true as const, key: input.key };
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

const PARTY_RETURN_CODES = new Set<BookingIdentityDocCode>([
  'civil_id_copy',
  'passport_copy',
  'cr_copy',
]);
const STAGED_ESIGN_CODES = new Set<'id-front' | 'id-back' | 'selfie'>([
  'id-front',
  'id-back',
  'selfie',
]);

/**
 * Tenant replaces one booking-identity document the owner returned for a fix
 * (party copy or id/selfie capture) before re-signing.
 */
export async function replaceReturnedBookingIdentityDoc(
  claims: SessionClaims,
  referenceCode: string,
  input: { code: string; fileName: string; dataUrl: string },
) {
  if (!isBookingIdentityDocCode(input.code)) leaseBookingFail('not_ready');
  const code = input.code;
  if (code === 'signature') leaseBookingFail('not_ready');
  const parsed = DATA_URL.exec(input.dataUrl);
  if (
    !parsed ||
    !REQUIREMENT_FILE_TYPES.includes(parsed[1]!) ||
    input.dataUrl.length > REQUIREMENT_FILE_MAX_CHARS
  ) {
    leaseBookingFail('invalid_file');
  }
  if ((STAGED_ESIGN_CODES as Set<string>).has(code) && !parsed[1]!.startsWith('image/')) {
    leaseBookingFail('invalid_file');
  }
  const mime = parsed[1]!;
  const size = Math.floor((parsed[2]!.length * 3) / 4);
  const name = input.fileName.trim().slice(0, 120) || code;
  const { db } = getDatabase();
  await db.transaction(async (transaction) => {
    const current = await customerReservation(transaction, claims.sub, referenceCode);
    const docsReturn = current.lifecycle.bookingDocsReturn;
    if (!docsReturn || docsReturn.resolvedAt) leaseBookingFail('not_ready');
    const rejected = new Set(docsReturn.rejected ?? []);
    if (!rejected.has(code)) leaseBookingFail('not_ready');
    if ((docsReturn.locked ?? []).includes(code)) leaseBookingFail('not_ready');

    if (PARTY_RETURN_CODES.has(code)) {
      const party = current.snapshot.party;
      if (!party) leaseBookingFail('not_ready');
      const attach = { name, mime, size, dataUrl: input.dataUrl };
      let nextParty = party;
      if (code === 'civil_id_copy' || code === 'passport_copy') {
        if (party.entityType !== 'person' || !party.person) leaseBookingFail('not_ready');
        nextParty = {
          ...party,
          person: {
            ...party.person,
            ...(code === 'civil_id_copy' ? { civilIdCopy: attach } : { passportCopy: attach }),
          },
        };
      } else {
        if (party.entityType !== 'company' || !party.company) leaseBookingFail('not_ready');
        nextParty = {
          ...party,
          company: { ...party.company, crCopy: attach },
        };
      }
      const replaced = [
        ...new Set([...(docsReturn.replaced ?? []).filter((item) => item !== code), code]),
      ];
      await saveLifecycle(
        transaction,
        { id: current.match.id, snapshot: current.snapshot },
        { ...current.lifecycle, bookingDocsReturn: { ...docsReturn, replaced } },
        { snapshot: { party: nextParty } },
      );
    } else if ((STAGED_ESIGN_CODES as Set<string>).has(code)) {
      const [stored] = await transaction
        .insert(workflowEvents)
        .values({
          organizationId: current.match.organizationId,
          actorUserId: claims.sub,
          resourceType: 'reservation_esign_fix',
          resourceId: current.match.id,
          eventType: 'reservation.esign_fix_file',
          metadata: {
            referenceCode: current.snapshot.referenceCode,
            code,
            name,
            mime,
            size,
            dataUrl: input.dataUrl,
          },
        })
        .returning({ id: workflowEvents.id });
      const fixFiles = {
        ...(docsReturn.fixFiles ?? {}),
        [code]: { eventId: stored!.id, name, mime },
      };
      const replaced = [
        ...new Set([...(docsReturn.replaced ?? []).filter((item) => item !== code), code]),
      ];
      await saveLifecycle(
        transaction,
        { id: current.match.id, snapshot: current.snapshot },
        { ...current.lifecycle, bookingDocsReturn: { ...docsReturn, fixFiles, replaced } },
      );
    } else {
      leaseBookingFail('not_ready');
    }

    await logEvent(transaction, {
      orgId: current.match.organizationId,
      actorUserId: claims.sub,
      reservationId: current.match.id,
      eventType: 'reservation.booking_doc_replaced',
      status: current.status,
      metadata: { referenceCode: current.snapshot.referenceCode, code },
    });
  });
  return { replaced: true as const, code };
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
    assertTenantAttested(current.lifecycle);

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
  | 'signature'
  | 'id-front'
  | 'id-back'
  | 'selfie'
  | 'contract-signature'
  | 'party-civil-id'
  | 'party-passport'
  | 'party-cr'
  | `doc-${string}`
  | `cheque-${string}`;

const ESIGN_FIELDS: Record<string, string> = {
  signature: 'signaturePng',
  'id-front': 'idFrontPng',
  'id-back': 'idBackPng',
  selfie: 'selfiePng',
};

const PARTY_FILE_PATH: Record<string, string[]> = {
  'party-civil-id': ['person', 'civilIdCopy'],
  'party-passport': ['person', 'passportCopy'],
  'party-cr': ['company', 'crCopy'],
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
    if (file in PARTY_FILE_PATH) {
      let cursor: unknown = match.snapshot.party;
      for (const key of PARTY_FILE_PATH[file]!) {
        cursor =
          cursor && typeof cursor === 'object' ? (cursor as Record<string, unknown>)[key] : null;
      }
      const attach =
        cursor && typeof cursor === 'object'
          ? (cursor as { dataUrl?: unknown; name?: unknown })
          : null;
      const value = typeof attach?.dataUrl === 'string' ? attach.dataUrl : null;
      const name = typeof attach?.name === 'string' ? attach.name : file;
      return value ? { value, name } : null;
    }
    let eventId: string | null = null;
    let path: string[] = [];
    let name = file;
    if (file in ESIGN_FIELDS) {
      const staged =
        file === 'id-front' || file === 'id-back' || file === 'selfie'
          ? lifecycle.bookingDocsReturn?.fixFiles?.[file]
          : undefined;
      if (staged?.eventId) {
        const value = await withElevatedRead(transaction, async () => {
          const [row] = await transaction
            .select({ metadata: workflowEvents.metadata })
            .from(workflowEvents)
            .where(
              and(
                eq(workflowEvents.id, staged.eventId),
                eq(workflowEvents.organizationId, match.organizationId),
              ),
            )
            .limit(1);
          const meta = row?.metadata;
          return meta &&
            typeof meta === 'object' &&
            typeof (meta as { dataUrl?: unknown }).dataUrl === 'string'
            ? (meta as { dataUrl: string }).dataUrl
            : null;
        });
        return value ? { value, name: staged.name || file } : null;
      }
      eventId =
        match.snapshot.esign?.evidenceEventId ??
        lifecycle.bookingDocsReturn?.evidenceEventId ??
        null;
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
    } else if (file.startsWith('cheque-')) {
      const submission = (lifecycle.chequeSubmissions ?? []).find(
        (item) => item.key === file.slice(7),
      );
      eventId = submission?.file?.eventId ?? null;
      name = submission?.file?.name ?? file;
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

/** Tenant (booking owner) can re-open documents / cheques they uploaded. */
export async function readReservationFileForTenant(
  claims: SessionClaims,
  referenceCode: string,
  file: string,
): Promise<{ mimeType: string; bytes: Buffer; name: string } | null> {
  const isDoc = /^doc-[a-z0-9_]{2,40}$/i.test(file);
  const isCheque = /^cheque-[a-z0-9_.-]{2,80}$/i.test(file);
  const isEsign = file in ESIGN_FIELDS;
  const isParty = file in PARTY_FILE_PATH;
  if (!isDoc && !isCheque && !isEsign && !isParty) return null;
  const { db } = getDatabase();
  const dataUrl = await db.transaction(async (transaction) => {
    const current = await customerReservation(transaction, claims.sub, referenceCode);
    const lifecycle = current.lifecycle;
    const docsReturn =
      lifecycle.bookingDocsReturn && !lifecycle.bookingDocsReturn.resolvedAt
        ? lifecycle.bookingDocsReturn
        : null;

    if (isParty) {
      // Show the current party copy when present (locked original or tenant re-upload).
      let cursor: unknown = current.snapshot.party;
      for (const key of PARTY_FILE_PATH[file]!) {
        cursor =
          cursor && typeof cursor === 'object' ? (cursor as Record<string, unknown>)[key] : null;
      }
      const attach =
        cursor && typeof cursor === 'object'
          ? (cursor as { dataUrl?: unknown; name?: unknown })
          : null;
      const value = typeof attach?.dataUrl === 'string' ? attach.dataUrl : null;
      const name = typeof attach?.name === 'string' ? attach.name : file;
      return value ? { value, name } : null;
    }

    if (isEsign) {
      if (!docsReturn) return null;
      const staged =
        file === 'id-front' || file === 'id-back' || file === 'selfie'
          ? docsReturn.fixFiles?.[file]
          : undefined;
      if (staged?.eventId) {
        const value = await withElevatedRead(transaction, async () => {
          const [row] = await transaction
            .select({ metadata: workflowEvents.metadata })
            .from(workflowEvents)
            .where(
              and(
                eq(workflowEvents.id, staged.eventId),
                eq(workflowEvents.organizationId, current.match.organizationId),
              ),
            )
            .limit(1);
          const meta = row?.metadata;
          return meta && typeof meta === 'object' && typeof (meta as { dataUrl?: unknown }).dataUrl === 'string'
            ? ((meta as { dataUrl: string }).dataUrl)
            : null;
        });
        return value ? { value, name: staged.name || file } : null;
      }
      if (!(docsReturn.locked ?? []).includes(file as BookingIdentityDocCode)) {
        return null;
      }
      const eventId = docsReturn.evidenceEventId ?? null;
      if (!eventId) return null;
      const path = ['esign', ESIGN_FIELDS[file]!];
      const value = await withElevatedRead(transaction, async () => {
        const [row] = await transaction
          .select({ metadata: workflowEvents.metadata })
          .from(workflowEvents)
          .where(
            and(
              eq(workflowEvents.id, eventId),
              eq(workflowEvents.organizationId, current.match.organizationId),
            ),
          )
          .limit(1);
        let cursor: unknown = row?.metadata;
        for (const key of path) {
          cursor =
            cursor && typeof cursor === 'object' ? (cursor as Record<string, unknown>)[key] : null;
        }
        return typeof cursor === 'string' ? cursor : null;
      });
      return value ? { value, name: file } : null;
    }

    let eventId: string | null = null;
    let name = file;
    if (file.startsWith('doc-')) {
      const requirement = (lifecycle.requirements ?? []).find(
        (item) => item.code === file.slice(4),
      );
      eventId = requirement?.file?.eventId ?? null;
      name = requirement?.file?.name ?? file;
    } else if (file.startsWith('cheque-')) {
      const submission = (lifecycle.chequeSubmissions ?? []).find(
        (item) => item.key === file.slice(7),
      );
      eventId = submission?.file?.eventId ?? null;
      name = submission?.file?.name ?? file;
    }
    if (!eventId) return null;
    const id = eventId;
    const value = await withElevatedRead(transaction, async () => {
      const [row] = await transaction
        .select({ metadata: workflowEvents.metadata })
        .from(workflowEvents)
        .where(
          and(
            eq(workflowEvents.id, id),
            eq(workflowEvents.organizationId, current.match.organizationId),
          ),
        )
        .limit(1);
      const meta = row?.metadata as { dataUrl?: unknown } | null;
      return typeof meta?.dataUrl === 'string' ? meta.dataUrl : null;
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
    // Legacy awaiting-accept records: promote so the tenant sees the record + objection window.
    if (handoverAwaitingTenant(lifecycle)) {
      const handover = lifecycle.handover!;
      const acceptedAt = handover.at;
      const defectsUntil = handover.defectsUntil ?? handoverDefectsUntilFrom(handover.at);
      await saveLifecycle(
        transaction,
        { id: match.id, snapshot: match.snapshot },
        {
          ...lifecycle,
          handover: { ...handover, status: 'accepted', acceptedAt, defectsUntil },
        },
      );
      return { state: 'handed_over' as const };
    }
    return {
      state: 'pass' as const,
      ...issueHandoverPass(match.id),
      selfie: handoverSelfieState(lifecycle),
      scannedBy: lifecycle.handoverScan?.byName ?? null,
    };
  });
}

/** A short email to the tenant about the handover; their booking page carries the details. */
async function queueTenantHandoverEmail(
  tx: Tx,
  input: {
    orgId: string;
    reservationId: string;
    recipient: string | null;
    referenceCode: string;
    subject: string;
    lines: string[];
  },
) {
  const link = `${publicWebOrigin()}/ar/book/confirmed?ref=${encodeURIComponent(input.referenceCode)}`;
  const queued = await queueBrandedEmail(tx, {
    orgId: input.orgId,
    recipient: input.recipient,
    subject: input.subject,
    aggregateType: 'reservation',
    aggregateId: input.reservationId,
    tone: 'booking',
    title: input.subject,
    lines: input.lines,
    details: [{ label: 'رقم الحجز', value: input.referenceCode }],
    cta: { label: 'فتح الحجز', url: link },
  });
  if (queued) sendQueuedEmailsSoon();
}

/** The tenant's selfie at the door, re-encoded once with the platform mark and stored as evidence. */
export async function submitHandoverSelfie(
  claims: SessionClaims,
  referenceCode: string,
  photo: HandoverPhotoInput,
) {
  const [branded] = await brandHandoverPhotos([photo]);
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    const current = await customerReservation(transaction, claims.sub, referenceCode);
    const lifecycle = current.lifecycle;
    const handover = lifecycle.handover;
    if (current.phase !== 'awaiting_handover' && !handoverAwaitingTenant(lifecycle)) {
      leaseBookingFail('not_ready');
    }
    const owed = handover?.status === 'awaiting_tenant' && !handover.recipientPhoto;
    if (!owed && handoverSelfieState(lifecycle) !== 'requested') {
      leaseBookingFail('handover_selfie_closed');
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
        eventType: 'reservation.handover_selfie',
        metadata: { referenceCode: current.snapshot.referenceCode, recipientPhoto: branded!.data },
      })
      .returning({ id: workflowEvents.id });
    const selfie = { at, evidenceEventId: evidence!.id, photo: branded!.meta };
    const scan = lifecycle.handoverScan ?? { at, byName: null, byUserId: null, selfie: null };
    await saveLifecycle(
      transaction,
      { id: current.match.id, snapshot: current.snapshot },
      {
        ...lifecycle,
        handoverScan: { ...scan, selfie },
        ...(handover && owed
          ? {
              handover: {
                ...handover,
                recipientPhoto: branded!.meta,
                recipientPhotoEventId: evidence!.id,
              },
            }
          : {}),
      },
    );
    await logEvent(transaction, {
      orgId,
      actorUserId: claims.sub,
      reservationId: current.match.id,
      eventType: 'reservation.handover_selfie_taken',
      status: current.status,
      metadata: { referenceCode: current.snapshot.referenceCode, evidenceEventId: evidence!.id },
    });
    return { takenAt: at };
  });
}

/**
 * Who the scanned pass belongs to, for the staff member about to hand over the keys. With
 * `requestSelfie`, a fresh scan asks the tenant's own phone for a selfie (page prompt + email).
 */
export async function previewHandover(
  claims: SessionClaims,
  key: HandoverKey,
  options: { requestSelfie?: boolean } = {},
) {
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
    let lifecycle = lifecycleOf(match.snapshot);
    const phase = phaseOf(match.status, match.snapshot, lifecycle);
    if (
      options.requestSelfie &&
      phase === 'awaiting_handover' &&
      !handoverAwaitingTenant(lifecycle) &&
      !handoverSelfieState(lifecycle)
    ) {
      const row = await loadForOwner(tx, claims, reservationId);
      if (!handoverSelfieState(row.lifecycle) && !row.lifecycle.handover) {
        const byName = await viewerName(tx, claims.sub);
        lifecycle = {
          ...row.lifecycle,
          handoverScan: {
            at: new Date().toISOString(),
            byName,
            byUserId: claims.sub,
            selfie: null,
          },
        };
        await saveLifecycle(tx, row, lifecycle);
        await queueTenantHandoverEmail(tx, {
          orgId: row.orgId,
          reservationId: row.id,
          recipient: match.partyEmail,
          referenceCode: row.snapshot.referenceCode,
          subject: `التقط صورة سيلفي لاستلام العقار — ${row.snapshot.referenceCode}`,
          lines: [
            `مسح ${byName ?? 'ممثل المالك'} رمز التسليم الخاص بك لحجز ${row.snapshot.referenceCode}.`,
            'افتح صفحة حجزك الآن والتقط صورة سيلفي لنفسك من هاتفك لتوثيق استلامك للمفتاح.',
          ],
        });
      } else {
        lifecycle = row.lifecycle;
      }
    }
    const party = match.snapshot.party as { nameAr?: unknown } | undefined;
    const liveSelfie = handoverLiveSelfie(lifecycle);
    const handlerSelfie = handoverHandlerSelfie(lifecycle);
    return {
      selfieRequestedAt: lifecycle.handoverScan?.at ?? null,
      liveSelfieAt: liveSelfie?.at ?? null,
      handlerSelfieAt: handlerSelfie?.at ?? null,
      handlerSelfieBy: handlerSelfie?.byName ?? null,
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

/**
 * The staff member's own selfie at the door, from their device, asked for at the same moment as
 * the tenant's. Both faces go on the handover record.
 */
export async function submitHandlerSelfie(
  claims: SessionClaims,
  key: HandoverKey,
  photo: HandoverPhotoInput,
) {
  if (!claims.organizationId || !hasPermission(claims, 'reservation.handover')) fail('forbidden');
  const [branded] = await brandHandoverPhotos([photo]);
  return withinViewerTenant(claims, async (tx) => {
    const reservationId = await reservationIdForKey(tx, key);
    const row = await loadForOwner(tx, claims, reservationId);
    assertOpen(row);
    const existing = row.lifecycle.handover;
    if (!row.lifecycle.tenantSignature || (existing && existing.status !== 'awaiting_tenant')) {
      fail('reservation_not_ready');
    }
    const at = new Date().toISOString();
    const byName = await viewerName(tx, claims.sub);
    const [evidence] = await tx
      .insert(workflowEvents)
      .values({
        organizationId: row.orgId,
        actorUserId: claims.sub,
        resourceType: 'reservation_handover',
        resourceId: row.id,
        eventType: 'reservation.handover_handler_selfie',
        metadata: { referenceCode: row.snapshot.referenceCode, handlerPhoto: branded!.data },
      })
      .returning({ id: workflowEvents.id });
    const scan = row.lifecycle.handoverScan ?? {
      at,
      byName,
      byUserId: claims.sub,
      selfie: null,
    };
    await saveLifecycle(tx, row, {
      ...row.lifecycle,
      handoverScan: {
        ...scan,
        handlerSelfie: {
          at,
          evidenceEventId: evidence!.id,
          photo: branded!.meta,
          byUserId: claims.sub,
          byName,
        },
      },
    });
    await logEvent(tx, {
      orgId: row.orgId,
      actorUserId: claims.sub,
      reservationId: row.id,
      eventType: 'reservation.handover_handler_selfie_taken',
      status: row.status,
      metadata: { referenceCode: row.snapshot.referenceCode, evidenceEventId: evidence!.id },
    });
    return { takenAt: at };
  });
}

/**
 * Faces for the staff member at the door: the selfie the tenant took when signing, the tenant's
 * live selfie, or the staff member's own selfie.
 */
export async function readHandoverSelfie(
  claims: SessionClaims,
  key: HandoverKey,
  which: 'signing' | 'live' | 'handler' = 'signing',
): Promise<{ mimeType: string; bytes: Buffer } | null> {
  const preview = await previewHandover(claims, key);
  const { db } = getDatabase();
  const dataUrl = await db.transaction(async (transaction) => {
    const match = await findLeaseReservation(transaction, 'id', preview.reservationId);
    const lifecycle = match ? lifecycleOf(match.snapshot) : null;
    const eventId =
      which === 'live'
        ? handoverLiveSelfie(lifecycle)?.evidenceEventId
        : which === 'handler'
          ? handoverHandlerSelfie(lifecycle)?.evidenceEventId
          : match?.snapshot.esign?.evidenceEventId;
    if (!match || !eventId) return null;
    const path =
      which === 'live'
        ? sql<string | null>`${workflowEvents.metadata}->>'recipientPhoto'`
        : which === 'handler'
          ? sql<string | null>`${workflowEvents.metadata}->>'handlerPhoto'`
          : sql<string | null>`${workflowEvents.metadata}->'esign'->>'selfiePng'`;
    return withElevatedRead(transaction, async () => {
      const [row] = await transaction
        .select({ png: path })
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
 * The staff member records the handover after scanning the tenant's pass: keys, notes
 * and photos of the premises. The record is effective immediately; the tenant can view it
 * and file an objection within the defects window. Meter readings and municipal contract
 * numbers are completed later by the owner/admin on the booking page.
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
    photos: HandoverPhotoInput[];
  },
) {
  if (!claims.organizationId || !hasPermission(claims, 'reservation.handover')) fail('forbidden');
  const recipientName = input.recipientName.trim().slice(0, 120);
  if (recipientName.length < 2 || input.photos.length > HANDOVER_PHOTOS_MAX) {
    leaseBookingFail('handover_invalid');
  }
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
    const handlerSelfie = handoverHandlerSelfie(row.lifecycle, now);
    if (!handlerSelfie) leaseBookingFail('handover_handler_selfie_required');
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
          photos: photos.map((photo) => photo.data),
        },
      })
      .returning({ id: workflowEvents.id });
    const selfie = handoverLiveSelfie(row.lifecycle, now);
    const defectsUntil = handoverDefectsUntilFrom(at, now);
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
        // Effective immediately — tenant views the record and may object within the window.
        status: 'accepted',
        evidenceEventId: evidence!.id,
        recipientPhoto: selfie?.photo ?? null,
        recipientPhotoEventId: selfie?.evidenceEventId ?? null,
        handlerPhoto: handlerSelfie.photo,
        handlerPhotoEventId: handlerSelfie.evidenceEventId,
        photos: photos.map((photo) => photo.meta),
        acceptedAt: at,
        defectsUntil,
        defects: null,
      },
    };
    await saveLifecycle(tx, row, lifecycle);
    await logEvent(tx, {
      orgId: row.orgId,
      actorUserId: claims.sub,
      reservationId: row.id,
      eventType: 'reservation.handed_over',
      status: row.status,
      metadata: {
        referenceCode: row.snapshot.referenceCode,
        byName,
        recipientName,
        photos: photos.length,
        evidenceEventId: evidence!.id,
        method: 'scan',
        acceptedAt: at,
        defectsUntil,
      },
    });
    await tx.insert(outboxEvents).values({
      organizationId: row.orgId,
      topic: 'reservation.handed_over',
      aggregateType: 'reservation',
      aggregateId: row.id,
      payload: {
        referenceCode: row.snapshot.referenceCode,
        acceptedAt: at,
        defectsUntil,
      },
    });
    const tenant = await findLeaseReservation(tx, 'id', row.id);
    await queueTenantHandoverEmail(tx, {
      orgId: row.orgId,
      reservationId: row.id,
      recipient: tenant?.partyEmail ?? null,
      referenceCode: row.snapshot.referenceCode,
      subject: `محضر تسليم العقار — اطّلع واعترض إن لزم خلال ${HANDOVER_DEFECTS_HOURS} ساعات — ${row.snapshot.referenceCode}`,
      lines: [
        `سجّل ${byName ?? 'ممثل المالك'} محضر تسليم العقار إليك، وأصبح التسليم نافذاً.`,
        'راجع المحضر والصور في صفحة حجزك؛ لا تحتاج إلى موافقة منفصلة.',
        `يحق لك رفع اعتراض مع صور خلال ${HANDOVER_DEFECTS_HOURS} ساعات، وإلا يُعتبر أنك استلمته بدون عيوب وفي حالة جيدة.`,
      ],
    });
    return {
      referenceCode: row.snapshot.referenceCode,
      offeredAt: at,
      acceptedAt: at,
      defectsUntil,
      hasSelfie: Boolean(selfie),
    };
  });
}

/**
 * Legacy: older records waited for an explicit tenant accept. New handovers are already
 * accepted on staff send; this promotes any leftover awaiting record and opens defects.
 */
export async function acceptHandover(claims: SessionClaims, referenceCode: string) {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    const current = await customerReservation(transaction, claims.sub, referenceCode);
    const handover = current.lifecycle.handover;
    if (handover?.status === 'accepted') {
      return {
        acceptedAt: handover.acceptedAt ?? handover.at,
        defectsUntil: handover.defectsUntil ?? handoverDefectsUntilFrom(handover.at),
      };
    }
    if (!handover || handover.status !== 'awaiting_tenant') leaseBookingFail('not_ready');
    const acceptedAt = handover.at;
    const defectsUntil =
      handover.defectsUntil ?? handoverDefectsUntilFrom(handover.at);
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
        promotedFromAwaiting: true,
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
  const reported = await db.transaction(async (transaction) => {
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
    return { reportedAt: at, reservationId: current.match.id };
  });
  await notifyOwnersOfCustomerStep(reported.reservationId, {
    subject: '🔍 أبلغ المستأجر عن ملاحظات بعد الاستلام',
    title: 'ملاحظات جديدة على العقار بعد التسليم',
    line: `أرفق المستأجر ${photos.length} صورة لملاحظات لاحظها بعد الاستلام${note ? `: «${note}»` : ''}. راجعها وخطّط لمعالجتها.`,
  });
  return { reportedAt: reported.reportedAt };
}

/**
 * `handover-recipient` (tenant's selfie), `handover-handler` (staff member's selfie),
 * `handover-<n>` (premises) or `defect-<n>` (tenant's defect photos).
 */
export const HANDOVER_PHOTO_FILE =
  /^(?:handover-recipient|handover-handler|handover-[0-5]|defect-[0-5])$/;

/** One stored handover photo as a data URL, read inside an organization-scoped transaction. */
export async function handoverPhotoDataUrl(
  tx: Tx,
  orgId: string,
  lifecycle: ReservationLifecycle,
  file: string,
): Promise<string | null> {
  const handover = lifecycle.handover;
  if (!handover || !HANDOVER_PHOTO_FILE.test(file)) return null;
  const eventId = file.startsWith('defect-')
    ? handover.defects?.evidenceEventId
    : file === 'handover-recipient'
      ? (handover.recipientPhotoEventId ?? handover.evidenceEventId)
      : file === 'handover-handler'
        ? handover.handlerPhotoEventId
        : handover.evidenceEventId;
  if (!eventId) return null;
  const path =
    file === 'handover-recipient'
      ? sql`${workflowEvents.metadata}->>'recipientPhoto'`
      : file === 'handover-handler'
        ? sql`${workflowEvents.metadata}->>'handlerPhoto'`
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
