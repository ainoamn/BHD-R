import 'server-only';
import { randomBytes } from 'node:crypto';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import {
  addresses,
  holds,
  listings,
  outboxEvents,
  parties,
  properties,
  propertyProfiles,
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
import { resolveApprovalPolicy } from '@/lib/approval-policy-neon';
import type { TermsBlock } from '@/lib/booking-terms';
import { depositForMode } from '@/lib/booking-deposit';
import { readTermsLetterhead, resolveBookingTerms } from '@/lib/booking-terms-neon';
import { reservationSignatureSerial } from '@/lib/contract-verify';
import { leaseSignPath } from '@/lib/lease-booking-paths';
import {
  approvedElectronically,
  leaseJourneyPhase,
  lifecycleOf,
  type ReservationLifecycle,
} from '@/lib/lease-reservation-lifecycle';
import { effectiveMinLeaseMonths } from '@/lib/lease-min-term-neon';
import { ownerPartyScope } from '@/lib/portal-ops-data';
import { loadPropertyLocation } from '@/lib/property-location-neon';
import {
  parseReservationParty,
  reservationPartyError,
  type ReservationParty,
} from '@/lib/reservation-party';
import { readUnitSaleDeposits } from '@/lib/unit-sale-deposit-neon';

export const LEASE_BOOKING_FLOW = 'public_deposit_v1';
export const LEASE_BOOKING_TERMS_VERSION = '2026-10';

/** Unpaid checkout blocks the unit only briefly, like a stay hold. */
const CHECKOUT_TTL_MS = 30 * 60 * 1000;
/** A paid deposit keeps the unit reserved while the owner prepares the final contract. */
const PAID_RESERVATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type LeaseBookingMode = 'rent' | 'sale';

export type LeaseBookingSnapshot = {
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
  /** Tenant or buyer details the customer filled in; prefills the final contract. */
  party?: ReservationParty;
  /** `other` when the account holder books on behalf of the person in `contact`. */
  bookingFor?: 'self' | 'other';
  bookedBy?: { userId: string; displayName: string; email: string | null };
  termsVersion: string;
  termsAcceptedAt: string;
  /** Owner-written terms the customer accepted; null means platform defaults were shown. */
  ownerTerms?: {
    version: number;
    bodyAr: string | null;
    bodyEn: string | null;
    source?: 'property' | 'organization';
    blocks?: TermsBlock[];
  } | null;
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
  lifecycle?: ReservationLifecycle;
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
  mode_unavailable: [
    409,
    'هذا الخيار غير متاح لهذه الوحدة.',
    'This option is not offered for this unit.',
  ],
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
  not_ready: [
    409,
    'هذه الخطوة غير متاحة الآن — حدّث الصفحة لترى أين وصل حجزك.',
    'This step is not open right now — refresh to see where your booking stands.',
  ],
  requirement_not_found: [
    404,
    'لم يعد هذا المستند مطلوباً.',
    'This document is no longer required.',
  ],
  invalid_file: [
    400,
    'الملف غير مدعوم أو كبير جداً — أرسل صورة أو PDF بحجم أصغر.',
    'Unsupported or too large — send an image or a PDF under the size limit.',
  ],
  tenant_details_invalid: [
    400,
    'أكمل بيانات المستأجر أو المشتري بشكل صحيح.',
    'Complete the tenant or buyer details correctly.',
  ],
  passport_required: [
    400,
    'رقم الجواز إلزامي لغير العمانيين.',
    'A passport number is required for non-Omanis.',
  ],
  cr_expired: [
    400,
    'السجل التجاري منتهٍ — يجب تجديده أولاً.',
    'The commercial registration has expired — renew it first.',
  ],
  cr_expiring_soon: [
    400,
    'السجل التجاري ينتهي خلال أقل من شهرين — يجب تجديده أولاً.',
    'The commercial registration expires in under two months — renew it first.',
  ],
  term_too_short: [
    400,
    'مدة العقد أقل من الحد الأدنى الذي حدده المالك.',
    'The contract term is shorter than the owner’s minimum.',
  ],
  handover_pass_invalid: [
    400,
    'رمز التسليم غير صالح أو انتهت صلاحيته — اطلب من المستأجر تحديث صفحة حجزه وأعد المسح.',
    'The handover code is invalid or expired — ask the tenant to refresh their booking page and scan again.',
  ],
  handover_invalid: [
    400,
    'أكمل بيانات التسليم: اسم المستلم والصور بالعدد المسموح.',
    'Complete the handover details: the recipient’s name and photos within the limit.',
  ],
  handover_selfie_required: [
    409,
    'التقط صورة سيلفي لنفسك أولاً، ثم أكّد استلام العقار.',
    'Take a selfie first, then confirm you received the premises.',
  ],
  handover_handler_selfie_required: [
    409,
    'التقط صورة سيلفي لنفسك من جهازك أولاً — يُوثَّق التسليم بوجه المستلم والمسلِّم معاً.',
    'Take a selfie of yourself on your device first — the handover records both the recipient’s and the handler’s faces.',
  ],
  handover_selfie_closed: [
    409,
    'لا يُطلب منك سيلفي الآن — اطلب من ممثل المالك مسح رمزك مرة أخرى.',
    'No selfie is being asked for now — ask the owner’s representative to scan your code again.',
  ],
  handover_defects_closed: [
    409,
    'انتهت مهلة الساعات الثلاث لإرفاق ملاحظات الاستلام، واعتُبر العقار مستلماً بحالته.',
    'The three-hour window to report defects has ended; the premises count as accepted as they are.',
  ],
} as const satisfies Record<string, readonly [number, string, string]>;

export type LeaseBookingErrorCode = keyof typeof ERRORS;

export function leaseBookingFail(code: LeaseBookingErrorCode): never {
  return fail(code);
}

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

export function leasePaymentPath(
  locale: 'ar' | 'en',
  sessionReference: string,
  referenceCode: string,
) {
  const qs = new URLSearchParams({ kind: 'lease', return: leaseSignPath(locale, referenceCode) });
  return `/${locale}/payments/sandbox/${encodeURIComponent(sessionReference)}?${qs.toString()}`;
}

export async function lockKey(transaction: Tx, key: string) {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 43))`);
}

export async function findLeaseReservation(
  transaction: Tx,
  key: 'id' | 'referenceCode' | 'checkoutSessionReference',
  value: string,
) {
  const match =
    key === 'id'
      ? eq(reservations.id, value)
      : sql`${reservations.termsSnapshot}->>${sql.raw(`'${key}'`)} = ${value}`;
  return withElevatedRead(transaction, async () => {
    const rows = await transaction
      .select({
        id: reservations.id,
        organizationId: reservations.organizationId,
        unitId: reservations.unitId,
        tenantPartyId: reservations.tenantPartyId,
        status: reservations.status,
        expiresAt: reservations.expiresAt,
        convertedLeaseId: reservations.convertedLeaseId,
        termsSnapshot: reservations.termsSnapshot,
        unitCode: units.code,
        unitNameAr: units.nameAr,
        unitNameEn: units.nameEn,
        unitRentMinor: units.rentMinor,
        unitSalePriceMinor: units.salePriceMinor,
        unitCurrency: units.currency,
        unitMinorUnit: units.minorUnit,
        unitDepositMinor: units.depositMinor,
        unitFloor: units.floor,
        unitAreaSquareMeters: units.areaSquareMeters,
        propertyId: properties.id,
        propertyNameAr: properties.nameAr,
        propertyNameEn: properties.nameEn,
        ownerPartyId: properties.ownerPartyId,
        partyEmail: parties.email,
        partyName: parties.displayName,
        partyType: parties.type,
        partyPhone: parties.phone,
      })
      .from(reservations)
      .innerJoin(units, eq(units.id, reservations.unitId))
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .innerJoin(parties, eq(parties.id, reservations.tenantPartyId))
      .where(and(sql`${reservations.termsSnapshot}->>'flow' = ${LEASE_BOOKING_FLOW}`, match))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { ...row, snapshot: row.termsSnapshot as unknown as LeaseBookingSnapshot };
  });
}

export async function assertBookingOwner(
  transaction: Tx,
  userId: string,
  partyEmail: string | null,
) {
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
  /** Reference of the terms shown to the customer (`property:n`, `organization:n`, or `default`). */
  termsRef: string;
  bookingFor: 'self' | 'other';
  party: ReservationParty;
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
      const row = rows[0];
      if (!row) return undefined;
      const saleDeposits = await readUnitSaleDeposits(transaction, row.organizationId, [
        input.unitId,
      ]);
      return { ...row, saleDepositMinor: saleDeposits.get(input.unitId)?.amountMinor ?? null };
    });
    if (!preview) fail('unit_unavailable');
    if (!modeAllowed(preview.listingPurpose, input.mode)) fail('mode_unavailable');
    const depositMinor = depositForMode(
      input.mode,
      preview.depositMinor?.toString(),
      preview.saleDepositMinor,
    );
    if (!depositMinor) fail('deposit_not_set');

    await applyOrgScope(transaction, {
      organizationId: preview.organizationId,
      userId: claims.sub,
    });
    await lockKey(transaction, input.unitId);
    const party = await ensureProspectParty(transaction, preview.organizationId, claims);
    const resolvedTerms = await resolveBookingTerms(
      transaction,
      preview.organizationId,
      preview.propertyId,
      input.mode,
    );
    const ownerTerms =
      resolvedTerms.terms && resolvedTerms.source !== 'default'
        ? {
            version: resolvedTerms.terms.version,
            bodyAr: resolvedTerms.terms.bodyAr,
            bodyEn: resolvedTerms.terms.bodyEn,
            source: resolvedTerms.source,
            blocks: resolvedTerms.terms.blocks,
          }
        : null;
    const assertTermsCurrent = () => {
      if (resolvedTerms.ref !== input.termsRef) fail('terms_changed');
    };
    const partyError = reservationPartyError(input.party, {
      mode: input.mode,
      minMonths: await effectiveMinLeaseMonths(
        transaction,
        preview.organizationId,
        preview.propertyId,
      ),
      today: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat' }).format(new Date()),
    });
    if (partyError) fail(partyError);
    const bookingParty: ReservationParty =
      input.mode === 'sale'
        ? { ...input.party, contractType: null, termMonths: null }
        : input.party;

    const now = new Date();
    const contact = {
      fullName: input.fullName.trim(),
      phone: input.phone.trim(),
      email: input.email?.trim() || null,
    };
    const booker = {
      bookingFor: input.bookingFor,
      bookedBy: { userId: claims.sub, displayName: party.displayName, email: party.email },
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
        depositMinor,
        locale: input.locale,
        contact,
        party: bookingParty,
        ...booker,
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
        amountMinor: depositMinor,
        currency: snapshot.currency,
        expiresAt: own.expiresAt.toISOString(),
        alreadyPaid: false as const,
        nextPath: leasePaymentPath(
          input.locale,
          snapshot.checkoutSessionReference,
          snapshot.referenceCode,
        ),
      };
    }

    assertTermsCurrent();
    const unit = await assertUnitBookable(transaction, input.unitId, input.mode).catch(
      (error: unknown) => {
        if (error instanceof Error && error.message === 'unit_unavailable')
          fail('unit_unavailable');
        throw error;
      },
    );
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
      depositMinor,
      currency: unit.currency,
      rentMinor: unit.rentMinor?.toString() ?? null,
      salePriceMinor: preview.salePriceMinor?.toString() ?? null,
      contact,
      party: bookingParty,
      ...booker,
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
    const match = await findLeaseReservation(
      transaction,
      'checkoutSessionReference',
      sessionReference,
    );
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
    const match = await findLeaseReservation(
      transaction,
      'checkoutSessionReference',
      sessionReference,
    );
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
    const { policy } = await resolveApprovalPolicy(
      transaction,
      match.organizationId,
      match.propertyId,
    );
    const lifecycle = lifecycleOf(snapshot);
    const nextSnapshot: LeaseBookingSnapshot = {
      ...snapshot,
      ...(policy.payment === 'manual'
        ? { lifecycle: { ...lifecycle, paymentReview: { status: 'pending', reportedAt: paidAt } } }
        : {}),
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

type LeaseReservationMatch = NonNullable<Awaited<ReturnType<typeof findLeaseReservation>>>;

const SIGNATURE_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** The lifecycle without the owner's working draft and stored file ids. */
function visibleLifecycle(lifecycle: ReservationLifecycle) {
  return {
    paymentUnderReview: lifecycle.paymentReview?.status === 'pending',
    approvedAt: lifecycle.approval?.at ?? null,
    approvedAutomatically: Boolean(lifecycle.approval?.automatic),
    electronic: approvedElectronically(lifecycle),
    contractPreparedAt: lifecycle.contractDraft?.savedAt ?? null,
    requirements: (lifecycle.requirements ?? []).map((item) => ({
      code: item.code,
      labelAr: item.labelAr,
      labelEn: item.labelEn,
      status: item.status,
      note: item.note ?? null,
      fileName: item.file?.name ?? null,
      submittedAt: item.file?.submittedAt ?? null,
      autoApproved: Boolean(item.autoApproved),
      verified: Boolean(item.verifiedAt) && item.status === 'approved',
    })),
    contract: lifecycle.contract
      ? {
          id: lifecycle.contract.id,
          reference: lifecycle.contract.reference,
          issuedAt: lifecycle.contract.issuedAt,
          automatic: Boolean(lifecycle.contract.automatic),
        }
      : null,
    cancellation: lifecycle.cancellation
      ? {
          at: lifecycle.cancellation.at,
          reason: lifecycle.cancellation.reason,
          note: lifecycle.cancellation.note,
        }
      : null,
    tenantSignedAt: lifecycle.tenantSignature?.signedAt ?? null,
    handover: lifecycle.handover
      ? {
          on: lifecycle.handover.on,
          at: lifecycle.handover.at,
          recipientName: lifecycle.handover.recipientName,
          keys: lifecycle.handover.keys,
          notes: lifecycle.handover.notes,
          byName: lifecycle.handover.byName,
          electricityReading: lifecycle.handover.electricityReading,
          waterReading: lifecycle.handover.waterReading,
          status: lifecycle.handover.status ?? ('accepted' as const),
          scanned: lifecycle.handover.method === 'scan',
          hasRecipientPhoto: Boolean(lifecycle.handover.recipientPhoto),
          hasHandlerPhoto: Boolean(lifecycle.handover.handlerPhoto),
          photos: (lifecycle.handover.photos ?? []).map((photo) => photo.index),
          acceptedAt: lifecycle.handover.acceptedAt ?? null,
          defectsUntil: lifecycle.handover.defectsUntil ?? null,
          defects: lifecycle.handover.defects
            ? {
                at: lifecycle.handover.defects.at,
                note: lifecycle.handover.defects.note,
                photos: lifecycle.handover.defects.photos.map((photo) => photo.index),
              }
            : null,
        }
      : null,
  };
}

export type LeaseLifecycleView = ReturnType<typeof visibleLifecycle>;

function leaseBookingView(match: LeaseReservationMatch) {
  const snapshot = match.snapshot;
  const lifecycle = lifecycleOf(snapshot);
  return {
    phase: leaseJourneyPhase({
      status: match.status,
      depositPaidAt: snapshot.depositPaidAt ?? null,
      esignSignedAt: snapshot.esign?.signedAt ?? null,
      lifecycle,
    }),
    lifecycle: visibleLifecycle(lifecycle),
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
    party: parseReservationParty(snapshot.party),
    bookingFor: snapshot.bookingFor ?? 'self',
    bookedByName: snapshot.bookedBy?.displayName ?? null,
    termsAcceptedAt: snapshot.termsAcceptedAt,
    ownerTerms: snapshot.ownerTerms ?? null,
    depositPaidAt: snapshot.depositPaidAt ?? null,
    cardLast4: snapshot.payment?.cardLast4 ?? null,
    esignSignedAt: snapshot.esign?.signedAt ?? null,
    reservedUntil: match.expiresAt.toISOString(),
    sessionReference: snapshot.checkoutSessionReference,
  };
}

export async function loadLeaseBookingForViewer(userId: string, referenceCode: string) {
  const normalized = normalizeLeaseReference(referenceCode);
  if (!normalized) return null;
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    const match = await findLeaseReservation(transaction, 'referenceCode', normalized);
    if (!match) return null;
    await assertBookingOwner(transaction, userId, match.partyEmail);
    const location = await withElevatedRead(transaction, () =>
      loadPropertyLocation(transaction, match.organizationId, match.propertyId),
    ).catch(() => null);
    return { ...leaseBookingView(match), location };
  });
}

/**
 * The reservation with everything its agreement prints: landlord, premises, letterhead,
 * and once signed, the customer's signature image and its e-signature serial.
 */
export async function loadLeaseBookingAgreement(userId: string, referenceCode: string) {
  const normalized = normalizeLeaseReference(referenceCode);
  if (!normalized) return null;
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    const match = await findLeaseReservation(transaction, 'referenceCode', normalized);
    if (!match) return null;
    await assertBookingOwner(transaction, userId, match.partyEmail);
    return leaseBookingAgreementData(transaction, match);
  });
}

/**
 * The same agreement for the property side: staff of the reservation's organization with
 * `reservation.read`, and for an individual owner only on their own property. Null when the
 * reservation is not a website rent or purchase booking or the viewer may not see it.
 */
export async function loadLeaseBookingForStaff(claims: SessionClaims, reservationId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(reservationId)) return null;
  if (!claims.organizationId || !hasPermission(claims, 'reservation.read')) return null;
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    const match = await findLeaseReservation(transaction, 'id', reservationId);
    if (!match || match.organizationId !== claims.organizationId) return null;
    const ownerPartyId = ownerPartyScope(claims);
    if (ownerPartyId && match.ownerPartyId !== ownerPartyId) return null;
    const agreement = await leaseBookingAgreementData(transaction, match);
    const lifecycle = lifecycleOf(match.snapshot);
    return {
      ...agreement,
      propertyId: match.propertyId,
      bookedByEmail: match.snapshot.bookedBy?.email ?? null,
      paymentProvider: match.snapshot.payment?.provider ?? null,
      cardBrand: match.snapshot.payment?.cardBrand ?? null,
      salesDealId: match.snapshot.salesDealId ?? null,
      convertedLeaseId: match.convertedLeaseId,
      ownerLifecycle: lifecycle,
      formUnit: {
        id: match.unitId,
        code: match.unitCode,
        rentMinor: match.unitRentMinor?.toString() ?? null,
        salePriceMinor: match.unitSalePriceMinor?.toString() ?? null,
        depositMinor: match.unitDepositMinor?.toString() ?? null,
        currency: match.unitCurrency,
        floor: match.unitFloor,
        areaSquareMeters: match.unitAreaSquareMeters,
        electricityMeter: null,
        waterMeter: null,
      },
      formTenant: {
        id: match.tenantPartyId,
        displayName: match.partyName,
        type: match.partyType === 'company' ? ('company' as const) : ('person' as const),
        email: match.partyEmail,
        phone: match.partyPhone,
      },
    };
  });
}

/** The reservation behind a booking reference, for staff of its organization who may read it. */
export async function leaseReservationIdForStaff(claims: SessionClaims, referenceCode: string) {
  const normalized = normalizeLeaseReference(referenceCode);
  if (!normalized || !claims.organizationId || !hasPermission(claims, 'reservation.read')) {
    return null;
  }
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    const match = await findLeaseReservation(transaction, 'referenceCode', normalized);
    if (!match || match.organizationId !== claims.organizationId) return null;
    const ownerPartyId = ownerPartyScope(claims);
    if (ownerPartyId && match.ownerPartyId !== ownerPartyId) return null;
    return match.id;
  });
}

/** The booking agreement inside an open transaction of its organization (contract pages). */
export async function loadLeaseBookingAgreementInTx(
  transaction: Tx,
  orgId: string,
  reservationId: string,
) {
  if (!/^[0-9a-f-]{36}$/i.test(reservationId)) return null;
  const match = await findLeaseReservation(transaction, 'id', reservationId);
  if (!match || match.organizationId !== orgId) return null;
  return leaseBookingAgreementData(transaction, match);
}

async function leaseBookingAgreementData(transaction: Tx, match: LeaseReservationMatch) {
  const orgId = match.organizationId;
  const esign = match.snapshot.esign ?? null;
  return withElevatedRead(transaction, async () => {
    const [owner, premises, letterhead, signaturePng, location] = await Promise.all([
      transaction
        .select({
          displayName: parties.displayName,
          type: parties.type,
          email: parties.email,
          phone: parties.phone,
        })
        .from(parties)
        .where(and(eq(parties.organizationId, orgId), eq(parties.id, match.ownerPartyId)))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      transaction
        .select({
          propertyNameAr: properties.nameAr,
          propertyNameEn: properties.nameEn,
          kind: properties.kind,
          category: properties.category,
          serialNumber: properties.serialNumber,
          governorate: addresses.governorate,
          wilayat: addresses.wilayat,
          city: addresses.city,
          area: addresses.area,
          street: addresses.street,
          buildingNumber: addresses.buildingNumber,
          postalCode: addresses.postalCode,
          deedNumber: propertyProfiles.deedNumber,
          plotNumber: propertyProfiles.plotNumber,
          furnishing: propertyProfiles.furnishing,
          parkingSpaces: propertyProfiles.parkingSpaces,
          builtUpArea: propertyProfiles.builtUpAreaSquareMeters,
          floorsCount: propertyProfiles.floorsCount,
          yearBuilt: propertyProfiles.yearBuilt,
          unitFloor: units.floor,
          unitBedrooms: units.bedrooms,
          unitBathrooms: units.bathrooms,
          unitMajlis: units.majlis,
          unitHalls: units.halls,
          unitKitchens: units.kitchens,
          unitHasPool: units.hasPool,
          unitAreaSquareMeters: units.areaSquareMeters,
        })
        .from(units)
        .innerJoin(
          properties,
          and(eq(properties.id, units.propertyId), eq(properties.organizationId, orgId)),
        )
        .innerJoin(
          addresses,
          and(eq(addresses.id, properties.addressId), eq(addresses.organizationId, orgId)),
        )
        .leftJoin(
          propertyProfiles,
          and(
            eq(propertyProfiles.propertyId, properties.id),
            eq(propertyProfiles.organizationId, orgId),
          ),
        )
        .where(and(eq(units.organizationId, orgId), eq(units.id, match.unitId)))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      readTermsLetterhead(transaction, orgId).catch(() => null),
      esign
        ? transaction
            .select({
              png: sql<string | null>`${workflowEvents.metadata}->'esign'->>'signaturePng'`,
            })
            .from(workflowEvents)
            .where(
              and(
                eq(workflowEvents.organizationId, orgId),
                eq(workflowEvents.id, esign.evidenceEventId),
              ),
            )
            .limit(1)
            .then((rows) => rows[0]?.png ?? null)
        : Promise.resolve(null),
      loadPropertyLocation(transaction, orgId, match.propertyId),
    ]);
    const serial = esign ? await reservationSignatureSerial(transaction, orgId, match.id) : null;
    const png = signaturePng && SIGNATURE_IMAGE.test(signaturePng) ? signaturePng : null;
    return {
      ...leaseBookingView(match),
      reservationId: match.id,
      capturedAt: match.snapshot.capturedAt,
      owner,
      premises,
      location,
      letterhead,
      signature: esign ? { signedAt: esign.signedAt, png, serial } : null,
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
      return {
        completed: true as const,
        referenceCode: normalized,
        signedAt: snapshot.esign.signedAt,
        reservationId: match.id,
      };
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

    return {
      completed: true as const,
      referenceCode: normalized,
      signedAt,
      reservationId: match.id,
    };
  });
}
