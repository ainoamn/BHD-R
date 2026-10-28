import 'server-only';
import { and, asc, eq, or, type SQL } from 'drizzle-orm';
import { users, workflowEvents } from '@bhd-r/db';
import type { Tx } from '@/lib/public-booking-neon';
import type { ReservationActivityRow } from '@/lib/lease-reservation-timeline';

const BLOB_EVENT_TYPES = new Set([
  'reservation.esign_evidence',
  'reservation.esign_fix_file',
  'reservation.document_file',
  'reservation.cheque_file',
  'reservation.contract_esign_evidence',
  'reservation.handover_evidence',
  'reservation.handover_selfie',
  'reservation.handover_handler_selfie',
]);

function mapRow(row: {
  id: string;
  occurredAt: Date;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  metadata: unknown;
  actorName: string | null;
}): ReservationActivityRow {
  return {
    id: row.id,
    at: row.occurredAt.toISOString(),
    eventType: row.eventType,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    note: row.note,
    actorName: row.actorName,
    metadata:
      row.metadata && typeof row.metadata === 'object'
        ? (row.metadata as Record<string, unknown>)
        : {},
  };
}

/**
 * Owner/staff transaction log for a website booking (and optional linked contract).
 * Reads `workflow_events` only — never shown to the tenant.
 */
export async function loadBookingActivityRows(
  tx: Tx,
  organizationId: string,
  input: { reservationId: string; contractId?: string | null },
): Promise<ReservationActivityRow[]> {
  const scopes: SQL[] = [
    and(
      eq(workflowEvents.resourceType, 'reservation'),
      eq(workflowEvents.resourceId, input.reservationId),
    )!,
  ];
  if (input.contractId && /^[0-9a-f-]{36}$/i.test(input.contractId)) {
    scopes.push(
      and(
        eq(workflowEvents.resourceType, 'contract'),
        eq(workflowEvents.resourceId, input.contractId),
      )!,
    );
  }

  const rows = await tx
    .select({
      id: workflowEvents.id,
      occurredAt: workflowEvents.occurredAt,
      eventType: workflowEvents.eventType,
      fromStatus: workflowEvents.fromStatus,
      toStatus: workflowEvents.toStatus,
      note: workflowEvents.note,
      metadata: workflowEvents.metadata,
      resourceType: workflowEvents.resourceType,
      actorName: users.displayName,
    })
    .from(workflowEvents)
    .leftJoin(users, eq(users.id, workflowEvents.actorUserId))
    .where(and(eq(workflowEvents.organizationId, organizationId), or(...scopes)))
    .orderBy(asc(workflowEvents.occurredAt))
    .limit(200);

  return rows
    .filter(
      (row) =>
        (row.resourceType === 'reservation' || row.resourceType === 'contract') &&
        !BLOB_EVENT_TYPES.has(row.eventType),
    )
    .map(mapRow);
}

/** Contract page log: events on the contract, plus the source booking when linked. */
export async function loadContractActivityRows(
  tx: Tx,
  organizationId: string,
  input: { contractId: string; reservationId?: string | null },
): Promise<ReservationActivityRow[]> {
  if (input.reservationId && /^[0-9a-f-]{36}$/i.test(input.reservationId)) {
    return loadBookingActivityRows(tx, organizationId, {
      reservationId: input.reservationId,
      contractId: input.contractId,
    });
  }

  const rows = await tx
    .select({
      id: workflowEvents.id,
      occurredAt: workflowEvents.occurredAt,
      eventType: workflowEvents.eventType,
      fromStatus: workflowEvents.fromStatus,
      toStatus: workflowEvents.toStatus,
      note: workflowEvents.note,
      metadata: workflowEvents.metadata,
      actorName: users.displayName,
    })
    .from(workflowEvents)
    .leftJoin(users, eq(users.id, workflowEvents.actorUserId))
    .where(
      and(
        eq(workflowEvents.organizationId, organizationId),
        eq(workflowEvents.resourceType, 'contract'),
        eq(workflowEvents.resourceId, input.contractId),
      ),
    )
    .orderBy(asc(workflowEvents.occurredAt))
    .limit(120);

  return rows.map(mapRow);
}
