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
import {
  contractAccess,
  stayBookingIdOf,
  visibleContract,
  type ContractAccess,
} from '@/lib/contract-detail-neon';
import { lifecycleOf } from '@/lib/lease-reservation-lifecycle';
import { handoverPhotoDataUrl } from '@/lib/lease-reservation-lifecycle-neon';
import { findLeaseReservation } from '@/lib/public-lease-booking-neon';
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

  if (kind === 'check-in') {
    const lease = await leaseHandoverAnnex(access, contractId, portal);
    if (lease !== undefined) return lease;
  }

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
              phone: refund.guestPayout.phone ? account(refund.guestPayout.phone) : null,
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

/** The reservation a website rent or purchase contract was issued from, if any. */
function leaseReservationIdOf(snapshot: Record<string, unknown>): string | null {
  const source = record(snapshot.source);
  return source.type === 'lease_reservation' ? text(source.reservationId) : null;
}

/**
 * The handover record (A1) of a rent or purchase contract, made by scanning the tenant's pass:
 * keys, meters, the tenant receiving the key, premises photos and the tenant's defects.
 * Undefined when the contract did not come from a website booking.
 */
async function leaseHandoverAnnex(
  access: ContractAccess,
  contractId: string,
  portal: Portal,
): Promise<ContractAnnexDocument | null | undefined> {
  const { claims, orgId } = access;
  const loaded = await withinViewerTenant(claims, async (tx) => {
    const contract = await visibleContract(tx, contractId, access);
    if (!contract) return null;
    const snapshot = (contract.payloadSnapshot ?? {}) as Record<string, unknown>;
    const reservationId = leaseReservationIdOf(snapshot);
    if (!reservationId) return undefined;
    const match = await findLeaseReservation(tx, 'id', reservationId);
    if (!match || match.organizationId !== orgId) return null;
    const handover = lifecycleOf(match.snapshot).handover;
    if (!handover) return null;
    const party = (id: string) =>
      tx
        .select({ displayName: parties.displayName, phone: parties.phone, email: parties.email })
        .from(parties)
        .where(and(eq(parties.organizationId, orgId), eq(parties.id, id)))
        .limit(1)
        .then((rows) => rows[0] ?? null);
    const [letterhead, owner, tenant] = await Promise.all([
      readTermsLetterhead(tx, orgId).catch(() => null),
      party(contract.ownerPartyId),
      party(contract.tenantPartyId),
    ]);
    return { contract, snapshot, match, handover, letterhead, owner, tenant };
  });
  if (loaded === undefined || loaded === null) return loaded;

  const { contract, snapshot, match, handover } = loaded;
  const contractReference = contract.reference ?? `CTR-${contract.id.slice(0, 8).toUpperCase()}`;
  const tenantDetails = record(snapshot.tenantDetails);
  const photoSrc = (file: string) =>
    `/api/portal/contracts/${contract.id}/annex/check-in/photos/${file}?portal=${portal}`;
  const photos = (handover.photos ?? []).map((photo) => ({
    ...photo,
    src: photoSrc(String(photo.index)),
  }));
  const defects = handover.defects
    ? {
        at: handover.defects.at,
        note: handover.defects.note,
        photos: handover.defects.photos.map((photo) => ({
          ...photo,
          src: photoSrc(`defect-${photo.index}`),
        })),
      }
    : null;
  const recipientPhoto = handover.recipientPhoto
    ? { ...handover.recipientPhoto, src: photoSrc('recipient') }
    : null;
  const status = handover.status ?? 'accepted';

  return {
    kind: 'check-in',
    reference: annexReference(contractReference, 'check-in'),
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
    tenantPhone: loaded.tenant?.phone ?? null,
    tenantEmail: loaded.tenant?.email ?? null,
    property: { nameAr: match.propertyNameAr, nameEn: match.propertyNameEn },
    unit: { code: match.unitCode, nameAr: match.unitNameAr, nameEn: match.unitNameEn },
    bookingReference: match.snapshot.referenceCode,
    guestPageHref: `/book/confirmed?ref=${encodeURIComponent(match.snapshot.referenceCode)}`,
    recordedAt: handover.at,
    handover: {
      at: handover.at,
      recordedBy: handover.byName,
      noteKeys: [],
      customNote: handover.notes,
      notes: handover.notes,
      important: false,
      recipient: {
        name: handover.recipientName,
        phone: null,
        documentKind: null,
        documentHref: null,
      },
      photos,
      lease: {
        keys: handover.keys,
        electricityReading: handover.electricityReading,
        waterReading: handover.waterReading,
        recipientPhoto,
        status,
        acceptedAt: handover.acceptedAt ?? (status === 'accepted' ? handover.at : null),
        defectsUntil: handover.defectsUntil ?? null,
        defects,
      },
    },
    refund: null,
    fingerprint: sha256({
      contract: contract.id,
      annex: 'check-in',
      handover: {
        at: handover.at,
        on: handover.on,
        recordedBy: handover.byName,
        recipientName: handover.recipientName,
        keys: handover.keys,
        electricityReading: handover.electricityReading,
        waterReading: handover.waterReading,
        notes: handover.notes,
        status,
        acceptedAt: handover.acceptedAt ?? null,
        recipientPhoto: handover.recipientPhoto?.sha256 ?? null,
        photos: (handover.photos ?? []).map((photo) => photo.sha256),
        defects: handover.defects
          ? {
              at: handover.defects.at,
              note: handover.defects.note,
              photos: handover.defects.photos.map((photo) => photo.sha256),
            }
          : null,
      },
    }),
  };
}

/** A photo of an annex: `n` (condition), `recipient` or `defect-n` (rent or purchase handover). */
export type AnnexPhotoKey = number | 'recipient' | `defect-${number}`;

/** One condition photo of a check-in / check-out annex, after the contract's access checks. */
export async function readContractAnnexPhoto(
  contractId: string,
  portal: Portal,
  kind: 'check-in' | 'check-out',
  photo: AnnexPhotoKey,
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const access = await contractAccess(contractId, portal);
  if (!access) return null;
  return withinViewerTenant(access.claims, async (tx) => {
    const contract = await visibleContract(tx, contractId, access);
    if (!contract) return null;
    const snapshot = (contract.payloadSnapshot ?? {}) as Record<string, unknown>;
    const reservationId = leaseReservationIdOf(snapshot);
    if (reservationId) {
      if (kind !== 'check-in') return null;
      const match = await findLeaseReservation(tx, 'id', reservationId);
      if (!match || match.organizationId !== access.orgId) return null;
      const file =
        photo === 'recipient'
          ? 'handover-recipient'
          : typeof photo === 'number'
            ? `handover-${photo}`
            : photo;
      const dataUrl = await handoverPhotoDataUrl(
        tx,
        access.orgId,
        lifecycleOf(match.snapshot),
        file,
      );
      const parsed = dataUrl?.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
      return parsed ? { mimeType: parsed[1]!, bytes: Buffer.from(parsed[2]!, 'base64') } : null;
    }
    const bookingId = stayBookingIdOf(snapshot);
    if (!bookingId || typeof photo !== 'number') return null;
    return readHandoverPhoto(tx, access.orgId, bookingId, STAMP_KIND[kind], photo);
  });
}
