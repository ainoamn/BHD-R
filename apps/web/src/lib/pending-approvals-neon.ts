import 'server-only';
import { cookies } from 'next/headers';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { hasPermission, verifySessionToken, type SessionClaims } from '@bhd-r/authz';
import {
  approvalRequests,
  contracts,
  parties,
  properties,
  reservations,
  stayBookings,
  units,
} from '@bhd-r/db';
import {
  EMPTY_PENDING_APPROVALS,
  type PendingApprovalItem,
  type PendingApprovals,
} from '@/lib/pending-approvals-shared';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import {
  leaseJourneyPhase,
  phaseWaitsOn,
  type ReservationLifecycle,
} from '@/lib/lease-reservation-lifecycle';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';
import { requireSessionSecret } from '@/lib/runtime-env';
import {
  canDecideDepositRefunds,
  canPayDepositRefunds,
  loadDepositRefundQueue,
} from '@/lib/stay-deposit-refund-neon';
import {
  loadOpenClaimQueue,
  loadOpenComplaintQueue,
  type DepositClaimQueueRow,
} from '@/lib/stay-deposit-claims-neon';
import { canDecideUnitSale, listSaleDecisionUnits } from '@/lib/unit-sale-decision-neon';
import { withTimeoutFallback } from '@/lib/with-timeout';

const ITEM_LIMIT = 50;

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.toISOString();
}

function queueItem(
  kind: 'deposit_claim' | 'deposit_complaint',
  row: DepositClaimQueueRow,
  id: string,
): PendingApprovalItem {
  return {
    kind,
    id,
    reference: row.reference,
    propertyId: row.propertyId,
    propertyNameAr: row.propertyNameAr,
    propertyNameEn: row.propertyNameEn,
    unitCode: null,
    party: row.party,
    contractType: null,
    fromOn: null,
    requestedAt: row.since,
  };
}

/**
 * Contracts awaiting signature (for users with `contract.sign`), stay booking requests awaiting
 * approval (for users with `stay.booking.manage`), paid rent or purchase bookings awaiting their
 * final contract (for users with `reservation.manage`), and deposit refunds awaiting the host's
 * decision or the accountant's transfer, oldest first. Owner-scoped users only see their own
 * properties.
 */
export async function loadPendingApprovals(claims: SessionClaims): Promise<PendingApprovals> {
  const orgId = claims.organizationId;
  const canSign = hasPermission(claims, 'contract.sign');
  const canManageBookings =
    hasPermission(claims, 'stay.booking.manage') && hasPermission(claims, 'contract.create');
  const canManageReservations = hasPermission(claims, 'reservation.manage');
  const canDecideRefunds = canDecideDepositRefunds(claims);
  const canPayRefunds = canPayDepositRefunds(claims);
  const canDecideSale = canDecideUnitSale(claims);
  const complaints = (
    await loadOpenComplaintQueue(claims, ITEM_LIMIT).catch(() => [] as DepositClaimQueueRow[])
  ).map((row) => queueItem('deposit_complaint', row, row.claimId));
  if (
    !orgId ||
    (!canSign &&
      !canManageBookings &&
      !canManageReservations &&
      !canDecideRefunds &&
      !canPayRefunds &&
      !canDecideSale)
  ) {
    return complaints.length
      ? {
          ...EMPTY_PENDING_APPROVALS,
          items: complaints,
          refunds: complaints.length,
          total: complaints.length,
        }
      : EMPTY_PENDING_APPROVALS;
  }
  const ownerPartyId = ownerPartyScope(claims);

  return withinViewerTenant(claims, async (tx) => {
    const contractQuery = canSign
      ? tx
          .select({
            id: contracts.id,
            reference: contracts.reference,
            propertyId: properties.id,
            propertyNameAr: properties.nameAr,
            propertyNameEn: properties.nameEn,
            unitCode: units.code,
            party: parties.displayName,
            contractType: sql<string | null>`${contracts.payloadSnapshot}->'contract'->>'type'`,
            fromOn: sql<string | null>`${contracts.payloadSnapshot}->>'startsOn'`,
            requestedAt: approvalRequests.createdAt,
          })
          .from(approvalRequests)
          .innerJoin(contracts, eq(contracts.id, approvalRequests.resourceId))
          .innerJoin(units, eq(units.id, contracts.unitId))
          .innerJoin(properties, eq(properties.id, units.propertyId))
          .leftJoin(parties, eq(parties.id, contracts.tenantPartyId))
          .where(
            and(
              eq(approvalRequests.organizationId, orgId),
              eq(approvalRequests.resourceType, 'contract'),
              inArray(approvalRequests.status, ['pending', 'on_hold']),
              ne(contracts.status, 'void'),
              ne(contracts.status, 'signed'),
              ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
            ),
          )
          .orderBy(asc(approvalRequests.createdAt))
          .limit(ITEM_LIMIT)
      : Promise.resolve([]);

    const bookingQuery = canManageBookings
      ? tx
          .select({
            id: stayBookings.id,
            reference: stayBookings.referenceCode,
            propertyId: properties.id,
            propertyNameAr: properties.nameAr,
            propertyNameEn: properties.nameEn,
            unitCode: units.code,
            party: sql<
              string | null
            >`${stayBookings.pricingSnapshotJson}->'guestContact'->>'displayName'`,
            fromOn: stayBookings.checkInOn,
            requestedAt: stayBookings.createdAt,
          })
          .from(stayBookings)
          .innerJoin(properties, eq(properties.id, stayBookings.propertyId))
          .leftJoin(units, eq(units.id, stayBookings.unitId))
          .where(
            and(
              eq(stayBookings.organizationId, orgId),
              eq(stayBookings.status, 'request_pending'),
              ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
            ),
          )
          .orderBy(asc(stayBookings.createdAt))
          .limit(ITEM_LIMIT)
      : Promise.resolve([]);
    const reservationQuery = canManageReservations
      ? tx
          .select({
            id: reservations.id,
            reference: sql<string | null>`${reservations.termsSnapshot}->>'referenceCode'`,
            mode: sql<string | null>`${reservations.termsSnapshot}->>'mode'`,
            propertyId: properties.id,
            propertyNameAr: properties.nameAr,
            propertyNameEn: properties.nameEn,
            unitCode: units.code,
            party: sql<string | null>`${reservations.termsSnapshot}->'contact'->>'fullName'`,
            depositMinor: sql<string | null>`${reservations.termsSnapshot}->>'depositMinor'`,
            currency: reservations.currency,
            paidAt: sql<string>`${reservations.termsSnapshot}->>'depositPaidAt'`,
            status: reservations.status,
            esignAt: sql<string | null>`${reservations.termsSnapshot}->'esign'->>'signedAt'`,
            lifecycle: sql<ReservationLifecycle | null>`${reservations.termsSnapshot}->'lifecycle'`,
          })
          .from(reservations)
          .innerJoin(units, eq(units.id, reservations.unitId))
          .innerJoin(properties, eq(properties.id, units.propertyId))
          .where(
            and(
              eq(reservations.organizationId, orgId),
              inArray(reservations.status, ['confirmed', 'converted']),
              sql`${reservations.termsSnapshot}->>'depositPaidAt' is not null`,
              sql`${reservations.termsSnapshot}->'lifecycle'->'handover' is null`,
              ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
            ),
          )
          .orderBy(asc(reservations.updatedAt))
          .limit(ITEM_LIMIT)
      : Promise.resolve([]);
    const refundQuery =
      canDecideRefunds || canPayRefunds
        ? loadDepositRefundQueue(tx, orgId, { ownerPartyId, limit: ITEM_LIMIT })
        : Promise.resolve([]);
    const claimQuery = canDecideRefunds
      ? loadOpenClaimQueue(tx, orgId, { ownerPartyId, limit: ITEM_LIMIT })
      : Promise.resolve([]);
    const saleQuery = canDecideSale
      ? listSaleDecisionUnits(tx, orgId, { ownerPartyId, limit: ITEM_LIMIT })
      : Promise.resolve([]);
    const [contractRows, bookingRows, reservationRows, refundRows, claimRows, saleRows] =
      await Promise.all([
        contractQuery,
        bookingQuery,
        reservationQuery,
        refundQuery,
        claimQuery,
        saleQuery,
      ]);
    const depositItems = [
      ...claimRows.map((row) => queueItem('deposit_claim', row, row.bookingId)),
      ...complaints,
    ];
    const refundItems = refundRows.filter((row) =>
      row.step === 'decision' ? canDecideRefunds : canPayRefunds,
    );

    const items: PendingApprovalItem[] = [
      ...contractRows.map((row) => ({
        kind: 'contract' as const,
        id: row.id,
        reference: row.reference ?? row.id.slice(0, 8).toUpperCase(),
        propertyId: row.propertyId,
        propertyNameAr: row.propertyNameAr,
        propertyNameEn: row.propertyNameEn,
        unitCode: row.unitCode,
        party: row.party,
        contractType: row.contractType === 'sale' ? ('sale' as const) : ('lease' as const),
        fromOn: row.fromOn ? row.fromOn.slice(0, 10) : null,
        requestedAt: iso(row.requestedAt) ?? '',
      })),
      ...bookingRows.map((row) => ({
        kind: 'stay_booking' as const,
        id: row.id,
        reference: row.reference,
        propertyId: row.propertyId,
        propertyNameAr: row.propertyNameAr,
        propertyNameEn: row.propertyNameEn,
        unitCode: row.unitCode,
        party: row.party,
        contractType: null,
        fromOn: iso(row.fromOn)?.slice(0, 10) ?? null,
        requestedAt: iso(row.requestedAt) ?? '',
      })),
      ...reservationRows
        .flatMap((row) => {
          const phase = leaseJourneyPhase({
            status: row.status,
            depositPaidAt: row.paidAt,
            esignSignedAt: row.esignAt,
            lifecycle: row.lifecycle,
          });
          return phaseWaitsOn(phase) === 'owner' ? [{ ...row, phase }] : [];
        })
        .map((row) => ({
          kind: 'lease_reservation' as const,
          phase: row.phase,
          id: row.id,
          reference: row.reference ?? row.id.slice(0, 8).toUpperCase(),
          propertyId: row.propertyId,
          propertyNameAr: row.propertyNameAr,
          propertyNameEn: row.propertyNameEn,
          unitCode: row.unitCode,
          party: row.party,
          contractType: row.mode === 'sale' ? ('sale' as const) : ('lease' as const),
          fromOn: null,
          requestedAt: row.paidAt,
          amountMinor: row.depositMinor,
          currency: row.currency,
        })),
      ...refundItems.map((row) => ({
        kind: row.step === 'decision' ? ('deposit_refund' as const) : ('refund_transfer' as const),
        id: row.bookingId,
        reference: row.reference,
        propertyId: row.propertyId,
        propertyNameAr: row.propertyNameAr,
        propertyNameEn: row.propertyNameEn,
        unitCode: row.unitCode,
        party: row.party,
        contractType: null,
        fromOn: null,
        requestedAt: row.since,
        amountMinor: row.dueMinor,
        currency: row.currency,
      })),
      ...depositItems,
      ...saleRows.map((row) => ({
        kind: 'sale_decision' as const,
        id: row.unitId,
        reference: row.unitCode ?? row.unitId.slice(0, 8).toUpperCase(),
        propertyId: row.propertyId,
        propertyNameAr: row.propertyNameAr,
        propertyNameEn: row.propertyNameEn,
        unitCode: row.unitCode,
        party: row.tenant,
        contractType:
          row.reason === 'sold' || row.question === 'keep_selling'
            ? ('sale' as const)
            : ('lease' as const),
        fromOn: null,
        requestedAt: row.leasedSince,
        decision:
          row.question === 'keep_selling'
            ? ('keep_selling' as const)
            : row.reason === 'sold'
              ? ('hide_sold' as const)
              : ('hide_leased' as const),
      })),
    ].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));

    return {
      items,
      contracts: contractRows.length,
      bookings: bookingRows.length,
      reservations: items.filter((item) => item.kind === 'lease_reservation').length,
      refunds: refundItems.length + depositItems.length,
      total: items.length,
    };
  });
}

/** Same list for the signed-in viewer of a server component; empty on timeout or error. */
export async function loadViewerPendingApprovals(): Promise<PendingApprovals> {
  if (!hasDatabaseUrl()) return EMPTY_PENDING_APPROVALS;
  const token = (await cookies()).get('bhd_r_session')?.value;
  if (!token) return EMPTY_PENDING_APPROVALS;
  try {
    const claims = await verifySessionToken(token, requireSessionSecret());
    return await withTimeoutFallback(
      loadPendingApprovals(claims),
      2_500,
      EMPTY_PENDING_APPROVALS,
      'pending-approvals-neon',
    );
  } catch {
    return EMPTY_PENDING_APPROVALS;
  }
}
