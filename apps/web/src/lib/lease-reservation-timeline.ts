import {
  BOOKING_IDENTITY_DOC_LABELS,
  isBookingIdentityDocCode,
} from '@/lib/lease-reservation-lifecycle';
import { workflowEventLabel } from '@/lib/ui-labels';

export type ReservationActivityTone = 'done' | 'info' | 'warn' | 'danger';

export type ReservationActivityRow = {
  id: string;
  at: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  actorName: string | null;
  metadata: Record<string, unknown>;
};

export type ReservationActivityEvent = {
  key: string;
  at: string;
  tone: ReservationActivityTone;
  title: string;
  detail: string | null;
  by: string | null;
};

const DANGER = new Set([
  'reservation.cancelled',
  'reservation.document_rejected',
  'reservation.cheque_rejected',
]);
const WARN = new Set(['reservation.booking_docs_returned', 'reservation.auto_contract_skipped']);
const DONE = new Set([
  'reservation.deposit_paid',
  'reservation.deposit_confirmed',
  'reservation.payment_confirmed',
  'reservation.esign_completed',
  'reservation.owner_approved',
  'reservation.document_approved',
  'reservation.document_verified',
  'reservation.cheque_approved',
  'reservation.cheque_verified',
  'reservation.contract_issued',
  'reservation.converted',
  'reservation.handed_over',
  'reservation.restored',
  'reservation.documents_auto_accepted',
  'contract.signed',
  'contract.counterparty_signed',
]);

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function identityLabels(codes: unknown, ar: boolean): string | null {
  if (!Array.isArray(codes) || !codes.length) return null;
  const labels = codes
    .filter((code): code is string => typeof code === 'string')
    .filter(isBookingIdentityDocCode)
    .map((code) =>
      ar ? BOOKING_IDENTITY_DOC_LABELS[code].ar : BOOKING_IDENTITY_DOC_LABELS[code].en,
    );
  return labels.length ? labels.join(ar ? '، ' : ', ') : null;
}

function eventDetail(row: ReservationActivityRow, ar: boolean): string | null {
  const meta = row.metadata;
  const parts: string[] = [];
  const note = text(meta.note) ?? text(row.note);
  if (note) parts.push(note);

  if (row.eventType === 'reservation.booking_docs_returned') {
    const rejected = identityLabels(meta.rejected, ar);
    if (rejected) {
      parts.push(ar ? `للتعديل: ${rejected}` : `To fix: ${rejected}`);
    }
    const locked = identityLabels(meta.locked, ar);
    if (locked) {
      parts.push(ar ? `معتمدة: ${locked}` : `Locked: ${locked}`);
    }
  }

  if (row.eventType === 'reservation.booking_doc_replaced') {
    const code = text(meta.code);
    if (code && isBookingIdentityDocCode(code)) {
      const label = ar
        ? BOOKING_IDENTITY_DOC_LABELS[code].ar
        : BOOKING_IDENTITY_DOC_LABELS[code].en;
      parts.push(label);
    }
  }

  const code = text(meta.code);
  if (
    code &&
    (row.eventType === 'reservation.document_submitted' ||
      row.eventType === 'reservation.document_approved' ||
      row.eventType === 'reservation.document_rejected' ||
      row.eventType === 'reservation.document_verified')
  ) {
    parts.push(code);
  }

  const reason = text(meta.reason);
  if (reason) parts.push(reason);

  const contractReference = text(meta.contractReference);
  if (contractReference) {
    parts.push(ar ? `العقد ${contractReference}` : `Contract ${contractReference}`);
  }

  if (meta.automatic === true) {
    parts.push(ar ? 'إجراء تلقائي حسب السياسة' : 'Automatic per policy');
  }

  return parts.length ? parts.join(ar ? ' · ' : ' · ') : null;
}

function eventTone(eventType: string): ReservationActivityTone {
  if (DANGER.has(eventType)) return 'danger';
  if (WARN.has(eventType)) return 'warn';
  if (DONE.has(eventType)) return 'done';
  return 'info';
}

function actorLabel(row: ReservationActivityRow, ar: boolean): string | null {
  const fromMeta = text(row.metadata.byName);
  if (row.actorName?.trim()) return row.actorName.trim();
  if (fromMeta) return fromMeta;
  if (row.metadata.automatic === true) {
    return ar ? 'النظام' : 'System';
  }
  // Tenant / client actions often have an actor user without a staff display name in metadata.
  if (
    row.eventType.includes('document_submitted') ||
    row.eventType.includes('esign') ||
    row.eventType.includes('deposit_paid') ||
    row.eventType.includes('booking_doc_replaced') ||
    row.eventType.includes('tenant_attested') ||
    row.eventType.includes('cheque_submitted') ||
    row.eventType.includes('documents_package_sent') ||
    row.eventType.includes('converted')
  ) {
    return ar ? 'العميل' : 'Client';
  }
  return null;
}

/** Owner/staff activity log for a lease booking (and optional linked contract events). Newest first. */
export function buildReservationActivityLog(
  rows: ReservationActivityRow[],
  ar: boolean,
): ReservationActivityEvent[] {
  const locale = ar ? 'ar' : 'en';
  return rows
    .slice()
    .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
    .map((row) => ({
      key: row.id,
      at: row.at,
      tone: eventTone(row.eventType),
      title: workflowEventLabel(row.eventType, locale) || row.eventType,
      detail: eventDetail(row, ar),
      by: actorLabel(row, ar),
    }));
}
