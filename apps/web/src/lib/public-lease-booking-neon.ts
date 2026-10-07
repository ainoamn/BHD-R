import 'server-only';
import { randomBytes } from 'node:crypto';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import {
  holds,
  listings,
  outboxEvents,
  parties,
  properties,
  reservations,
  salesDeals,
  units,
  users,
  workflowEvents,
} from '@bhd-r/db';
import {
  applyOrgScope,
  assertUnitBookable,
  ensureProspectParty,
  getDatabase,
  withElevatedRead,
  type Tx,
} from '@/lib/public-booking-neon';
import { readActiveBookingTerms } from '@/lib/booking-terms-neon';
import { leaseSignPath } from '@/lib/lease-booking-paths';

export const LEASE_BOOKING_FLOW = 'public_deposit_v1';
export const LEASE_BOOKING_TERMS_VERSION = '2026-10';

/** Unpaid checkout blocks the unit only briefly, like a stay hold. */
const CHECKOUT_TTL_MS = 30 * 60 * 1000;
/** A paid deposit keeps the unit reserved while the owner prepares the final contract. */
const PAID_RESERVATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type LeaseBookingMode = 'rent' | 'sale';

type LeaseBookingSnapshot = {
  flow: typeof LEASE_BOOKING_FLOW;
  mode: LeaseBookingMode;
  referenceCode: string;
  checkoutSessionReference: string;
  locale: 'ar' | 'en';
  listingPurpose: string;
  depositMinor: string;
  currency: string;
  rentMinor: string | null;
  salePriceMinor: string | null;
  contact: { fullName: string; phone: string; email: string | null };
  termsVersion: string;
  termsAcceptedAt: string;
  /** Owner-written terms the customer accepted; null means platform defaults were shown. */
  ownerTerms?: { version: number; bodyAr: string | null; bodyEn: string | null } | null;
  awaitingPublicDepositPayment: boolean;
  capturedAt: string;
  depositPaidAt?: string;
  publicDepositPaidAt?: string;
  payment?: {
    provider: 'bhd_pay_sandbox';
    amountMinor: string;
    currency: string;
    paidAt: string;
    cardLast4?: string;
    cardBrand?: string;
  };
  salesDealId?: string;
  esign?: { signedAt: string; completed: true; evidenceEventId: string };
};

export class LeaseBookingError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly messageAr: string,
    message: string,
  ) {
    super(message);
    this.name = 'LeaseBookingError';
  }
}

const ERRORS = {
  unit_unavailable: [
    409,
    'الوحدة محجوزة أو غير متاحة حالياً.',
    'This unit is reserved or unavailable right now.',
  ],
  mode_unavailable: [409, 'هذا الخيار غير متاح لهذه الوحدة.', 'This option is not offered for this unit.'],
  deposit_not_set: [
    409,
    'لم يحدد مالك العقار مبلغ الضمان بعد.',
    'The owner has not set a booking deposit yet.',
  ],
  not_found: [404, 'لم يتم العثور على الحجز.', 'Booking not found.'],
  forbidden: [403, 'هذا الحجز مرتبط بحساب آخر.', 'This booking belongs to another account.'],
  booking_expired: [
    409,
    'انتهت مهلة الدفع لهذا الحجز — ابدأ الحجز من جديد.',
    'The payment window for this booking expired — please start again.',
  ],
  payment_required: [
    409,
    'أكمل دفع مبلغ الضمان قبل توقيع العقد.',
    'Pay the booking deposit before signing the contract.',
  ],
  terms_changed: [
    409,
    'حدّث المالك الشروط والأحكام — راجعها ووافق عليها مجدداً.',
    'The owner updated the terms — please review and accept them again.',
  ],
} as const satisfies Record<string, readonly [number, string, string]>;

function fail(code: keyof typeof ERRORS): never {
  const [status, messageAr, message] = ERRORS[code];
  throw new LeaseBookingError(code, status, messageAr, message);
}

const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newReferenceCode(): string {
  return `RSV-${Array.from(randomBytes(8), (byte) => REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length]).join('')}`;
}

function newSessionReference(): string {
  return `ls_${randomBytes(18).toString('base64url')}`;
}

export function normalizeLeaseReference(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return /^RSV-[A-Z0-9]{8}$/.test(normalized) ? normalized : null;
}

export function modeAllowed(listingPurpose: string, mode: LeaseBookingMode): boolean {
  if (listingPurpose === 'both') return true;
  return listingPurpose === mode;
}

export function leasePaymentPath(locale: 'ar' | 'en', sessionReference: string, referenceCode: string) {
  const qs = new URLSearchParams({ kind: 'lease', return: leaseSignPath(locale, referenceCode) });
  return `/${locale}/payments/sandbox/${encodeURIComponent(sessionReference)}?${qs.toString()}`;
}

async function lockKey(transaction: Tx, key: string) {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 43))`);
}

async function findLeaseReservation(
  transaction: Tx,
  key: 'referenceCode' | 'checkoutSessionReference',
  value: string,
) {
  return withElevatedRead(transaction, async () => {
    const rows = await transaction
      .select({
        id: reservations.id,
        organizationId: reservations.organizationId,
        unitId: reservations.unitId,
        tenantPartyId: reservations.tenantPartyId,
        status: reservations.status,
        expiresAt: reservations.expiresAt,
        termsSnapshot: reservations.termsSnapshot,
        unitCode: units.code,
        unitNameAr: units.nameAr,
        unitNameEn: units.nameEn,
        unitRentMinor: units.rentMinor,
        unitSalePriceMinor: units.salePriceMinor,
        unitCurrency: units.currency,
        unitMinorUnit: units.minorUnit,
        propertyId: properties.id,
        propertyNameAr: properties.nameAr,
        propertyNameEn: properties.nameEn,
        ownerPartyId: properties.ownerPartyId,
        partyEmail: parties.email,
      })
      .from(reservations)
      .innerJoin(units, eq(units.id, reservations.unitId))
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .innerJoin(parties, eq(parties.id, reservations.tenantPartyId))
      .where(
        and(
          sql`${reservations.termsSnapshot}->>'flow' = ${LEASE_BOOKING_FLOW}`,
          sql`${reservations.termsSnapshot}->>${sql.raw(`'${key}'`)} = ${value}`,
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { ...row, snapshot: row.termsSnapshot as unknown as LeaseBookingSnapshot };
  });
}

async function assertBookingOwner(transaction: Tx, userId: string, partyEmail: string | null) {
  const user = await withElevatedRead(transaction, () =>
    transaction.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { email: true },
    }),
  );
  const userEmail = user?.email?.trim().toLowerCase();
  if (!userEmail || !partyEmail || userEmail !== partyEmail.trim().toLowerCase()) fail('forbidden');
}

export type LeaseCheckoutInput = {
  unitId: string;
  mode: LeaseBookingMode;
  fullName: string;
  phone: string;
  email: string | null;
  locale: 'ar' | 'en';
  /** Owner terms version shown to the customer (0 = platform defaults). */
  termsVersion: number;
};

export async function createLeaseBookingCheckout(claims: SessionClaims, input: LeaseCheckoutInput) {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    const preview = await withElevatedRead(transaction, async () => {
      const rows = await transaction
        .select({
          organizationId: units.organizationId,
          propertyId: units.propertyId,
          listingPurpose: units.listingPurpose,
          depositMinor: units.depositMinor,
          salePriceMinor: units.salePriceMinor,
        })
        .from(units)
        .innerJoin(listings, eq(listings.unitId, units.id))
        .where(and(eq(units.id, input.unitId), eq(listings.enabled, true)))
        .limit(1);
      return rows[0];
    });
    if (!preview) fail('unit_unavailable');
    if (!modeAllowed(preview.listingPurpose, input.mode)) fail('mode_unavailable');
    if (!preview.depositMinor || preview.depositMinor <= 0n) fail('deposit_not_set');

    await applyOrgScope(transaction, {
      organizationId: preview.organizationId,
      userId: claims.sub,
    });
    await lockKey(transaction, input.unitId);
    const party = await ensureProspectParty(transaction, preview.organizationId, claims);
    const activeTerms = await readActiveBookingTerms(
      transaction,
      preview.organizationId,
      preview.propertyId,
      input.mode,
    );
    const ownerTerms = activeTerms
      ? { version: activeTerms.version, bodyAr: activeTerms.bodyAr, bodyEn: activeTerms.bodyEn }
      : null;
    const assertTermsCurrent = () => {
      if ((ownerTerms?.version ?? 0) !== input.termsVersion) fail('terms_changed');
    };

    const now = new Date();
    const contact = {
      fullName: input.fullName.trim(),
      phone: input.phone.trim(),
      email: input.email?.trim() || null,
    };

    const ownRows = await transaction
      .select({
        id: reservations.id,
        status: reservations.status,
        expiresAt: reservations.expiresAt,
        termsSnapshot: reservations.termsSnapshot,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.unitId, input.unitId),
          eq(reservations.tenantPartyId, party.id),
          inArray(reservations.status, ['pending', 'confirmed']),
          gt(reservations.expiresAt, now),
          sql`${reservations.termsSnapshot}->>'flow' = ${LEASE_BOOKING_FLOW}`,
        ),
      )
      .limit(1);
    const own = ownRows[0];
    if (own) {
      const snapshot = own.termsSnapshot as unknown as LeaseBookingSnapshot;
      if (snapshot.depositPaidAt) {
        return {
          referenceCode: snapshot.referenceCode,
          sessionReference: snapshot.checkoutSessionReference,
          amountMinor: snapshot.depositMinor,
          currency: snapshot.currency,
          expiresAt: own.expiresAt.toISOString(),
          alreadyPaid: true as const,
          nextPath: leaseSignPath(input.locale, snapshot.referenceCode),
        };
      }
      assertTermsCurrent();
      const nextSnapshot: LeaseBookingSnapshot = {
        ...snapshot,
        mode: input.mode,
        locale: input.locale,
        contact,
        termsVersion: LEASE_BOOKING_TERMS_VERSION,
        termsAcceptedAt: now.toISOString(),
        ownerTerms,
      };
      await transaction
        .update(reservations)
        .set({ termsSnapshot: nextSnapshot, updatedAt: now })
        .where(eq(reservations.id, own.id));
      return {
        referenceCode: snapshot.referenceCode,
        sessionReference: snapshot.checkoutSessionReference,
        amountMinor: snapshot.depositMinor,
        currency: snapshot.currency,
        expiresAt: own.expiresAt.toISOString(),
        alreadyPaid: false as const,
        nextPath: leasePaymentPath(input.locale, snapshot.checkoutSessionReference, snapshot.referenceCode),
      };
    }

    assertTermsCurrent();
    const unit = await assertUnitBookable(transaction, input.unitId).catch((error: unknown) => {
      if (error instanceof Error && error.message === 'unit_unavailable') fail('unit_unavailable');
      throw error;
    });
    const depositMinor = unit.depositMinor!;
    const expiresAt = new Date(now.getTime() + CHECKOUT_TTL_MS);
    const referenceCode = newReferenceCode();
    const sessionReference = newSessionReference();

    await transaction.insert(holds).values({
      organizationId: unit.organizationId,
      unitId: input.unitId,
      prospectPartyId: party.id,
      status: 'active',
      expiresAt,
      note: `Public deposit checkout ${referenceCode}`,
    });

    const snapshot: LeaseBookingSnapshot = {
      flow: LEASE_BOOKING_FLOW,
      mode: input.mode,
      referenceCode,
      checkoutSessionReference: sessionReference,
      locale: input.locale,
      listingPurpose: unit.listingPurpose,
      depositMinor: depositMinor.toString(),
      currency: unit.currency,
      rentMinor: unit.rentMinor?.toString() ?? null,
      salePriceMinor: preview.salePriceMinor?.toString() ?? null,
      contact,
      termsVersion: LEASE_BOOKING_TERMS_VERSION,
      termsAcceptedAt: now.toISOString(),
      ownerTerms,
      awaitingPublicDepositPayment: true,
      capturedAt: now.toISOString(),
    };

    const inserted = await transaction
      .insert(reservations)
      .values({
        organizationId: unit.organizationId,
        unitId: input.unitId,
        tenantPartyId: party.id,
        status: 'pending',
        expiresAt,
        rentMinor: unit.rentMinor,
        currency: unit.currency,
        termsSnapshot: snapshot,
      })
      .returning({ id: reservations.id });

    await transaction.insert(workflowEvents).values({
      organizationId: unit.organizationId,
      actorUserId: claims.sub,
      resourceType: 'reservation',
      resourceId: inserted[0]!.id,
      eventType: 'reservation.public_checkout_started',
      toStatus: 'pending',
      metadata: {
        referenceCode,
        mode: input.mode,
        termsVersion: LEASE_BOOKING_TERMS_VERSION,
        termsAcceptedAt: snapshot.termsAcceptedAt,
      },
    });

    return {
      referenceCode,
      sessionReference,
      amountMinor: snapshot.depositMinor,
      currency: unit.currency,
      expiresAt: expiresAt.toISOString(),
      alreadyPaid: false as const,
      nextPath: leasePaymentPath(input.locale, sessionReference, referenceCode),
    };
  });
}

/** Payment page summary — keyed by the unguessable session reference, no contact data. */
export async function lookupLeasePaymentSession(sessionReference: string) {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    const match = await findLeaseReservation(transaction, 'checkoutSessionReference', sessionReference);
    if (!match) return null;
    return {
      referenceCode: match.snapshot.referenceCode,
      mode: match.snapshot.mode,
      amountMinor: match.snapshot.depositMinor,
      currency: match.snapshot.currency,
      unitId: match.unitId,
      unitNameAr: match.unitNameAr,
      unitNameEn: match.unitNameEn,
      propertyNameAr: match.propertyNameAr,
      propertyNameEn: match.propertyNameEn,
      paid: Boolean(match.snapshot.depositPaidAt),
      expiresAt: match.expiresAt.toISOString(),
    };
  });
}

export async function completeLeaseSandboxPayment(
  claims: SessionClaims,
  sessionReference: string,
  card: { cardLast4?: string; cardBrand?: string },
) {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    const match = await findLeaseReservation(transaction, 'checkoutSessionReference', sessionReference);
    if (!match) fail('not_found');
    await assertBookingOwner(transaction, claims.sub, match.partyEmail);
    await applyOrgScope(transaction, { organizationId: match.organizationId, userId: claims.sub });
    await lockKey(transaction, match.id);

    const freshRows = await transaction
      .select({
        status: reservations.status,
        expiresAt: reservations.expiresAt,
        termsSnapshot: reservations.termsSnapshot,
      })
      .from(reservations)
      .where(eq(reservations.id, match.id))
      .limit(1);
    const fresh = freshRows[0];
    if (!fresh) fail('not_found');
    const snapshot = fresh.termsSnapshot as unknown as LeaseBookingSnapshot;
    const returnPath = leaseSignPath(snapshot.locale, snapshot.referenceCode);
    if (snapshot.depositPaidAt) {
      return {
        completed: true as const,
        kind: 'lease_reservation' as const,
        referenceCode: snapshot.referenceCode,
        returnPath,
      };
    }
    const now = new Date();
    if (fresh.status !== 'pending' || fresh.expiresAt <= now) fail('booking_expired');

    let salesDealId: string | undefined;
    if (snapshot.mode === 'sale') {
      const asking = match.unitSalePriceMinor ?? match.unitRentMinor;
      const deal = await transaction
        .insert(salesDeals)
        .values({
          organizationId: match.organizationId,
          reference: `SAL-${snapshot.referenceCode}`,
          propertyId: match.propertyId,
          unitId: match.unitId,
          sellerPartyId: match.ownerPartyId,
          buyerPartyId: match.tenantPartyId,
          status: 'reserved',
          askingPriceMinor: asking,
          currency: match.unitCurrency,
          minorUnit: match.unitMinorUnit,
          notes:
            snapshot.locale === 'ar'
              ? `حجز شراء من الموقع — عربون مدفوع (${snapshot.referenceCode})`
              : `Website purchase reservation — deposit paid (${snapshot.referenceCode})`,
        })
        .returning({ id: salesDeals.id });
      salesDealId = deal[0]!.id;
    }

    const paidAt = now.toISOString();
    const nextSnapshot: LeaseBookingSnapshot = {
      ...snapshot,
      awaitingPublicDepositPayment: false,
      depositPaidAt: paidAt,
      publicDepositPaidAt: paidAt,
      payment: {
        provider: 'bhd_pay_sandbox',
        amountMinor: snapshot.depositMinor,
        currency: snapshot.currency,
        paidAt,
        ...(card.cardLast4 ? { cardLast4: card.cardLast4 } : {}),
        ...(card.cardBrand ? { cardBrand: card.cardBrand } : {}),
      },
      ...(salesDealId ? { salesDealId } : {}),
    };

    await transaction
      .update(reservations)
      .set({
        status: 'confirmed',
        expiresAt: new Date(now.getTime() + PAID_RESERVATION_TTL_MS),
        termsSnapshot: nextSnapshot,
        updatedAt: now,
      })
      .where(eq(reservations.id, match.id));

    await transaction
      .update(holds)
      .set({ status: 'converted', updatedAt: now })
      .where(
        and(
          eq(holds.unitId, match.unitId),
          eq(holds.status, 'active'),
          eq(holds.prospectPartyId, match.tenantPartyId),
        ),
      );

    await transaction.insert(workflowEvents).values({
      organizationId: match.organizationId,
      actorUserId: claims.sub,
      resourceType: 'reservation',
      resourceId: match.id,
      eventType: 'reservation.deposit_paid',
      fromStatus: 'pending',
      toStatus: 'confirmed',
      metadata: {
        referenceCode: snapshot.referenceCode,
        mode: snapshot.mode,
        amountMinor: snapshot.depositMinor,
        currency: snapshot.currency,
        provider: 'bhd_pay_sandbox',
        ...(salesDealId ? { salesDealId } : {}),
      },
    });

    await transaction.insert(outboxEvents).values({
      organizationId: match.organizationId,
      topic: 'reservation.deposit_paid',
      aggregateType: 'reservation',
      aggregateId: match.id,
      payload: {
        referenceCode: snapshot.referenceCode,
        mode: snapshot.mode,
        unitId: match.unitId,
        amountMinor: snapshot.depositMinor,
        currency: snapshot.currency,
      },
    });

    return {
      completed: true as const,
      kind: 'lease_reservation' as const,
      referenceCode: snapshot.referenceCode,
      returnPath,
    };
  });
}

export async function loadLeaseBookingForViewer(userId: string, referenceCode: string) {
  const normalized = normalizeLeaseReference(referenceCode);
  if (!normalized) return null;
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    const match = await findLeaseReservation(transaction, 'referenceCode', normalized);
    if (!match) return null;
    await assertBookingOwner(transaction, userId, match.partyEmail);
    const snapshot = match.snapshot;
    return {
      referenceCode: snapshot.referenceCode,
      status: match.status,
      mode: snapshot.mode,
      unitId: match.unitId,
      unitCode: match.unitCode,
      unitNameAr: match.unitNameAr,
      unitNameEn: match.unitNameEn,
      propertyNameAr: match.propertyNameAr,
      propertyNameEn: match.propertyNameEn,
      depositMinor: snapshot.depositMinor,
      currency: snapshot.currency,
      rentMinor: snapshot.rentMinor,
      salePriceMinor: snapshot.salePriceMinor,
      contact: snapshot.contact,
      termsAcceptedAt: snapshot.termsAcceptedAt,
      ownerTerms: snapshot.ownerTerms ?? null,
      depositPaidAt: snapshot.depositPaidAt ?? null,
      cardLast4: snapshot.payment?.cardLast4 ?? null,
      esignSignedAt: snapshot.esign?.signedAt ?? null,
      reservedUntil: match.expiresAt.toISOString(),
      sessionReference: snapshot.checkoutSessionReference,
    };
  });
}

export async function completeLeaseEsign(
  claims: SessionClaims,
  referenceCode: string,
  input: { signaturePng: string; idFrontPng: string; idBackPng: string; selfiePng: string },
) {
  const normalized = normalizeLeaseReference(referenceCode);
  if (!normalized) fail('not_found');
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    const match = await findLeaseReservation(transaction, 'referenceCode', normalized);
    if (!match) fail('not_found');
    await assertBookingOwner(transaction, claims.sub, match.partyEmail);
    await applyOrgScope(transaction, { organizationId: match.organizationId, userId: claims.sub });
    await lockKey(transaction, match.id);

    const freshRows = await transaction
      .select({ status: reservations.status, termsSnapshot: reservations.termsSnapshot })
      .from(reservations)
      .where(eq(reservations.id, match.id))
      .limit(1);
    const fresh = freshRows[0];
    if (!fresh) fail('not_found');
    const snapshot = fresh.termsSnapshot as unknown as LeaseBookingSnapshot;
    if (!snapshot.depositPaidAt) fail('payment_required');
    if (snapshot.esign?.completed) {
      return { completed: true as const, referenceCode: normalized, signedAt: snapshot.esign.signedAt };
    }
    if (fresh.status !== 'confirmed' && fresh.status !== 'converted') fail('booking_expired');

    const signedAt = new Date().toISOString();
    // Evidence images live on their own resource type so reservation timelines stay light.
    const evidence = await transaction
      .insert(workflowEvents)
      .values({
        organizationId: match.organizationId,
        actorUserId: claims.sub,
        resourceType: 'reservation_esign_evidence',
        resourceId: match.id,
        eventType: 'reservation.esign_evidence',
        metadata: {
          referenceCode: normalized,
          esign: {
            signedAt,
            signaturePng: input.signaturePng,
            idFrontPng: input.idFrontPng,
            idBackPng: input.idBackPng,
            selfiePng: input.selfiePng,
          },
        },
      })
      .returning({ id: workflowEvents.id });
    const evidenceEventId = evidence[0]!.id;

    await transaction.insert(workflowEvents).values({
      organizationId: match.organizationId,
      actorUserId: claims.sub,
      resourceType: 'reservation',
      resourceId: match.id,
      eventType: 'reservation.esign_completed',
      fromStatus: fresh.status,
      toStatus: fresh.status,
      metadata: {
        referenceCode: normalized,
        signedAt,
        evidenceEventId,
        hasSignature: true,
        hasIdFront: true,
        hasIdBack: true,
        hasSelfie: true,
      },
    });

    await transaction.insert(outboxEvents).values({
      organizationId: match.organizationId,
      topic: 'reservation.esign_completed',
      aggregateType: 'reservation',
      aggregateId: match.id,
      payload: { referenceCode: normalized, signedAt, mode: snapshot.mode },
    });

    await transaction
      .update(reservations)
      .set({
        termsSnapshot: { ...snapshot, esign: { signedAt, completed: true, evidenceEventId } },
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, match.id));

    return { completed: true as const, referenceCode: normalized, signedAt };
  });
}
