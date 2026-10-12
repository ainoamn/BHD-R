import 'server-only';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { hasPermission } from '@bhd-r/authz';
import { parties, properties, stayBookings, units } from '@bhd-r/db';
import { readTermsLetterhead } from '@/lib/booking-terms-neon';
import {
  annexReference,
  type ContractAnnexDocument,
  type ContractAnnexKind,
} from '@/lib/contract-annex';
import { contractAccess, stayBookingIdOf, visibleContract } from '@/lib/contract-detail-neon';
import { withinViewerTenant } from '@/lib/portal-ops-data';
import { loadStayStamps, readHandoverPhoto, type StayStamp } from '@/lib/stay-arrival-neon';
import { maskAccount } from '@/lib/stay-deposit-refund';
import {
  canDecideDepositRefunds,
  canPayDepositRefunds,
  loadBookingDeposits,
  loadDepositRefunds,
} from '@/lib/stay-deposit-refund-neon';

type Portal = 'owner' | 'tenant' | 'developer';

const STAMP_KIND = { 'check-in': 'check_in', 'check-out': 'check_out' } as const;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * One annex of a stay contract (check-in, check-out or deposit refund) as its own document,
 * after the same access checks as the contract. Null when it is not recorded yet.
 */
export async function loadContractAnnexFromNeon(
  contractId: string,
  portal: Portal,
  kind: ContractAnnexKind,
): Promise<ContractAnnexDocument | null> {
  const access = await contractAccess(contractId, portal);
  if (!access) return null;
  const { claims, orgId } = access;
  const canManageStays = hasPermission(claims, 'stay.booking.manage');
  const canSeeAccounts = canDecideDepositRefunds(claims) || canPayDepositRefunds(claims);

  const loaded = await withinViewerTenant(claims, async (tx) => {
    const contract = await visibleContract(tx, contractId, access);
    if (!contract) return null;
    const snapshot = (contract.payloadSnapshot ?? {}) as Record<string, unknown>;
    const bookingId = stayBookingIdOf(snapshot);
    if (!bookingId) return null;
    const party = (id: string) =>
      tx
        .select({ displayName: parties.displayName, phone: parties.phone, email: parties.email })
        .from(parties)
        .where(and(eq(parties.organizationId, orgId), eq(parties.id, id)))
        .limit(1)
        .then((rows) => rows[0] ?? null);
    const [letterhead, owner, tenant, booking, unit, stamps, refunds, deposits] = await Promise.all(
      [
        readTermsLetterhead(tx, orgId).catch(() => null),
        party(contract.ownerPartyId),
        party(contract.tenantPartyId),
        tx
          .select({
            referenceCode: stayBookings.referenceCode,
            propertyId: stayBookings.propertyId,
            snapshot: stayBookings.pricingSnapshotJson,
          })
          .from(stayBookings)
          .where(and(eq(stayBookings.organizationId, orgId), eq(stayBookings.id, bookingId)))
          .limit(1)
          .then((rows) => rows[0] ?? null),
        tx
          .select({
            code: units.code,
            nameAr: units.nameAr,
            nameEn: units.nameEn,
            propertyNameAr: properties.nameAr,
            propertyNameEn: properties.nameEn,
          })
          .from(units)
          .innerJoin(properties, eq(properties.id, units.propertyId))
          .where(and(eq(units.organizationId, orgId), eq(units.id, contract.unitId)))
          .limit(1)
          .then((rows) => rows[0] ?? null),
        kind === 'deposit-refund'
          ? Promise.resolve(null)
          : loadStayStamps(tx, orgId, [bookingId]).then((map) => map.get(bookingId) ?? null),
        kind === 'deposit-refund'
          ? loadDepositRefunds(tx, orgId, [bookingId]).then((map) => map.get(bookingId) ?? null)
          : Promise.resolve(null),
        kind === 'deposit-refund'
          ? loadBookingDeposits(tx, orgId, [bookingId]).then((map) => map.get(bookingId) ?? null)
          : Promise.resolve(null),
      ],
    );
    return {
      contract,
      snapshot,
      bookingId,
      letterhead,
      owner,
      tenant,
      booking,
      unit,
      stamps,
      refunds,
      deposits,
    };
  });
  if (!loaded) return null;

  const { contract, snapshot, bookingId, booking, unit } = loaded;
  const contractReference = contract.reference ?? `CTR-${contract.id.slice(0, 8).toUpperCase()}`;
  const tenantDetails = record(snapshot.tenantDetails);
  const guestContact = record(record(booking?.snapshot).guestContact);
  const stamp: StayStamp | null =
    kind === 'check-in'
      ? (loaded.stamps?.checkIn ?? null)
      : kind === 'check-out'
        ? (loaded.stamps?.checkOut ?? null)
        : null;
  const refund = loaded.refunds;
  if (kind === 'deposit-refund' ? !refund : !stamp) return null;

  const handover: ContractAnnexDocument['handover'] = stamp
    ? {
        at: stamp.at,
        recordedBy: stamp.recordedBy,
        noteKeys: stamp.noteKeys,
        customNote: stamp.customNote,
        notes: stamp.notes,
        important: stamp.important,
        recipient: stamp.recipient
          ? {
              name: stamp.recipient.name,
              phone: stamp.recipient.phone,
              documentKind: stamp.recipient.documentKind,
              documentHref:
                stamp.recipient.hasDocument && canManageStays && booking
                  ? `/api/owner/properties/${booking.propertyId}/records/handover/${bookingId}`
                  : null,
            }
          : null,
        photos: stamp.photos.map((photo) => ({
          ...photo,
          src: `/api/portal/contracts/${contract.id}/annex/${kind}/photos/${photo.index}?portal=${portal}`,
        })),
      }
    : null;

  const account = (value: string) => (canSeeAccounts ? value : maskAccount(value));
  const refundView: ContractAnnexDocument['refund'] = refund
    ? {
        status: refund.status,
        currency: refund.currency,
        depositMinor: loaded.deposits,
        amountMinor: refund.amountMinor,
        requestedAt: refund.requestedAt,
        requestedBy: refund.requestedBy,
        consent: refund.consent,
        guestNote: refund.guestNote,
        guestPayout: refund.guestPayout
          ? {
              method: refund.guestPayout.method,
              account: account(refund.guestPayout.account),
              bank: refund.guestPayout.bank,
            }
          : null,
        decidedAt: refund.decidedAt,
        decidedBy: refund.decidedBy,
        decisionNote: refund.decisionNote,
        transfer: refund.transfer
          ? {
              at: refund.transfer.at,
              method: refund.transfer.method,
              account: account(refund.transfer.account),
              bank: refund.transfer.bank,
              holder: refund.transfer.holder,
              reference: refund.transfer.reference,
              recordedBy: refund.transfer.recordedBy,
              receiptHref:
                refund.transfer.hasReceipt && canSeeAccounts && booking
                  ? `/api/owner/properties/${booking.propertyId}/records/refund-receipt/${bookingId}`
                  : null,
            }
          : null,
      }
    : null;

  const fingerprint = sha256({
    contract: contract.id,
    annex: kind,
    handover: stamp
      ? {
          at: stamp.at,
          recordedBy: stamp.recordedBy,
          noteKeys: stamp.noteKeys,
          customNote: stamp.customNote,
          important: stamp.important,
          recipient: stamp.recipient
            ? {
                name: stamp.recipient.name,
                phone: stamp.recipient.phone,
                documentKind: stamp.recipient.documentKind,
              }
            : null,
          photos: stamp.photos.map((photo) => photo.sha256),
        }
      : null,
    refund: refund
      ? {
          status: refund.status,
          amountMinor: refund.amountMinor,
          currency: refund.currency,
          requestedAt: refund.requestedAt,
          consent: refund.consent,
          decidedAt: refund.decidedAt,
          decisionNote: refund.decisionNote,
          transfer: refund.transfer
            ? {
                at: refund.transfer.at,
                account: refund.transfer.account,
                bank: refund.transfer.bank,
                reference: refund.transfer.reference,
              }
            : null,
        }
      : null,
  });

  return {
    kind,
    reference: annexReference(contractReference, kind),
    contract: {
      id: contract.id,
      reference: contractReference,
      createdAt: contract.createdAt.toISOString(),
      startsOn: text(snapshot.startsOn),
      endsOn: text(snapshot.endsOn),
    },
    letterhead: loaded.letterhead,
    ownerName: loaded.owner?.displayName ?? '—',
    tenantName: text(tenantDetails.nameAr) ?? loaded.tenant?.displayName ?? '—',
    tenantPhone: loaded.tenant?.phone ?? text(guestContact.phone),
    tenantEmail: loaded.tenant?.email ?? text(guestContact.email),
    property: unit ? { nameAr: unit.propertyNameAr, nameEn: unit.propertyNameEn } : null,
    unit: unit ? { code: unit.code, nameAr: unit.nameAr, nameEn: unit.nameEn } : null,
    bookingReference: booking?.referenceCode ?? null,
    guestPageHref: booking
      ? `/guest/stays/${bookingId}?ref=${encodeURIComponent(booking.referenceCode)}`
      : null,
    recordedAt: stamp?.at ?? refund?.requestedAt ?? contract.createdAt.toISOString(),
    handover,
    refund: refundView,
    fingerprint,
  };
}

/** One condition photo of a check-in / check-out annex, after the contract's access checks. */
export async function readContractAnnexPhoto(
  contractId: string,
  portal: Portal,
  kind: 'check-in' | 'check-out',
  index: number,
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const access = await contractAccess(contractId, portal);
  if (!access) return null;
  return withinViewerTenant(access.claims, async (tx) => {
    const contract = await visibleContract(tx, contractId, access);
    if (!contract) return null;
    const bookingId = stayBookingIdOf((contract.payloadSnapshot ?? {}) as Record<string, unknown>);
    if (!bookingId) return null;
    return readHandoverPhoto(tx, access.orgId, bookingId, STAMP_KIND[kind], index);
  });
}
