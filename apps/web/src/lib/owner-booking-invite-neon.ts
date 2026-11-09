import 'server-only';
import { randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import {
  listings,
  properties,
  reservations,
  units,
  users,
  workflowEvents,
} from '@bhd-r/db';
import { depositForMode } from '@/lib/booking-deposit';
import { resolveBookingTerms } from '@/lib/booking-terms-neon';
import { appLink, notifyByEmail } from '@/lib/email-notify';
import { sendQueuedEmailsSoon } from '@/lib/email-outbox';
import { effectiveMinLeaseMonths } from '@/lib/lease-min-term-neon';
import {
  LEASE_BOOKING_FLOW,
  LEASE_BOOKING_TERMS_VERSION,
  LeaseBookingError,
  leasePaymentPath,
  lockKey,
  modeAllowed,
  type LeaseBookingMode,
  type LeaseBookingSnapshot,
} from '@/lib/public-lease-booking-neon';
import {
  applyOrgScope,
  assertUnitBookable,
  ensureProspectParty,
  getDatabase,
  withElevatedRead,
} from '@/lib/public-booking-neon';
import {
  partyDisplayName,
  reservationPartyError,
  type ReservationParty,
} from '@/lib/reservation-party';
import { upsertOwnerPartyFromReservation } from '@/lib/reservation-party-persist';
import { readUnitSaleDeposits } from '@/lib/unit-sale-deposit-neon';
import { notifyPartyWhatsApp } from '@/lib/whatsapp-notify';

/** Tenant has a week to accept terms, pay, and continue. */
const OWNER_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type OwnerBookingInviteInput = {
  unitId: string;
  mode: LeaseBookingMode;
  locale: 'ar' | 'en';
  party: ReservationParty;
  fullName: string;
  phone: string;
  email: string;
  /** electronic = auto contract draft when ready; manual = owner fills then sends. */
  contractPreference: 'electronic' | 'manual';
};

function fail(code: string, status = 409, messageAr = code, message = code): never {
  throw new LeaseBookingError(code, status, messageAr, message);
}

function newReferenceCode(): string {
  return `RSV-${Array.from(randomBytes(8), (byte) => REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length]).join('')}`;
}

function newSessionReference(): string {
  return `ls_${randomBytes(18).toString('base64url')}`;
}

/**
 * Landlord-initiated long-term rent/sale booking: same reservation snapshot as the
 * public deposit checkout, but the owner fills tenant + terms and the tenant is
 * invited by email + WhatsApp to pay and continue.
 */
export async function createOwnerBookingInvite(
  claims: SessionClaims,
  input: OwnerBookingInviteInput,
) {
  if (!hasPermission(claims, 'reservation.manage') && !hasPermission(claims, 'lease.create')) {
    fail('forbidden', 403, 'ليست لديك صلاحية إنشاء حجز.', 'Missing booking create permission.');
  }
  const email = input.email.trim().toLowerCase();
  const phone = input.phone.trim();
  const fullName = input.fullName.trim();
  if (!fullName || !phone || !email) {
    fail(
      'tenant_details_invalid',
      400,
      'أدخل اسم المستأجر والجوال والبريد.',
      'Enter the tenant name, phone, and email.',
    );
  }

  const { db } = getDatabase();
  const result = await db.transaction(async (transaction) => {
    const preview = await withElevatedRead(transaction, async () => {
      const rows = await transaction
        .select({
          organizationId: units.organizationId,
          propertyId: units.propertyId,
          listingPurpose: units.listingPurpose,
          depositMinor: units.depositMinor,
          salePriceMinor: units.salePriceMinor,
          rentMinor: units.rentMinor,
          currency: units.currency,
          unitNameAr: units.nameAr,
          unitNameEn: units.nameEn,
          propertyNameAr: properties.nameAr,
          propertyNameEn: properties.nameEn,
        })
        .from(units)
        .innerJoin(listings, eq(listings.unitId, units.id))
        .innerJoin(properties, eq(properties.id, units.propertyId))
        .where(
          and(
            eq(units.id, input.unitId),
            eq(listings.enabled, true),
            claims.organizationId
              ? eq(units.organizationId, claims.organizationId)
              : sql`true`,
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) return undefined;
      const saleDeposits = await readUnitSaleDeposits(transaction, row.organizationId, [
        input.unitId,
      ]);
      return { ...row, saleDepositMinor: saleDeposits.get(input.unitId)?.amountMinor ?? null };
    });
    if (!preview) fail('unit_unavailable', 409, 'الوحدة غير متاحة.', 'Unit unavailable.');
    if (!modeAllowed(preview.listingPurpose, input.mode)) {
      fail('mode_unavailable', 409, 'هذا الخيار غير متاح لهذه الوحدة.', 'Mode unavailable.');
    }
    const depositMinor = depositForMode(
      input.mode,
      preview.depositMinor?.toString(),
      preview.saleDepositMinor,
    );
    if (!depositMinor) {
      fail(
        'deposit_not_set',
        409,
        'حدّد مبلغ الضمان على الوحدة أولاً.',
        'Set the unit booking deposit first.',
      );
    }

    await applyOrgScope(transaction, {
      organizationId: preview.organizationId,
      userId: claims.sub,
    });
    await lockKey(transaction, input.unitId);

    const partyError = reservationPartyError(input.party, {
      mode: input.mode,
      minMonths: await effectiveMinLeaseMonths(
        transaction,
        preview.organizationId,
        preview.propertyId,
      ),
      today: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat' }).format(new Date()),
    });
    if (partyError) fail(partyError, 400, partyError, partyError);

    const bookingParty: ReservationParty =
      input.mode === 'sale'
        ? { ...input.party, contractType: null, termMonths: null }
        : input.party;

    const bookerParty = await ensureProspectParty(transaction, preview.organizationId, claims);
    const party = await upsertOwnerPartyFromReservation(transaction, {
      organizationId: preview.organizationId,
      party: bookingParty,
      bookingFor: 'other',
      bookerPartyId: bookerParty.id,
      bookerUserId: claims.sub,
    });

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

    await assertUnitBookable(transaction, input.unitId, input.mode).catch((error: unknown) => {
      if (error instanceof Error && error.message === 'unit_unavailable') {
        fail('unit_unavailable', 409, 'الوحدة محجوزة أو غير متاحة.', 'Unit unavailable.');
      }
      throw error;
    });

    const actorRows = await transaction
      .select({ displayName: users.displayName, email: users.email })
      .from(users)
      .where(eq(users.id, claims.sub))
      .limit(1);
    const actor = actorRows[0];

    const now = new Date();
    const expiresAt = new Date(now.getTime() + OWNER_INVITE_TTL_MS);
    const referenceCode = newReferenceCode();
    const sessionReference = newSessionReference();
    const contact = { fullName, phone, email };

    const snapshot: LeaseBookingSnapshot & {
      source: 'owner_invite';
      contractPreference: 'electronic' | 'manual';
      tenantTermsAcceptedAt: null;
    } = {
      flow: LEASE_BOOKING_FLOW,
      mode: input.mode,
      referenceCode,
      checkoutSessionReference: sessionReference,
      locale: input.locale,
      listingPurpose: preview.listingPurpose,
      depositMinor,
      currency: preview.currency,
      rentMinor: preview.rentMinor?.toString() ?? null,
      salePriceMinor: preview.salePriceMinor?.toString() ?? null,
      contact,
      party: bookingParty,
      bookingFor: 'other',
      bookedBy: {
        userId: claims.sub,
        displayName: actor?.displayName ?? 'Owner',
        email: actor?.email ?? null,
      },
      termsVersion: LEASE_BOOKING_TERMS_VERSION,
      // Owner prepared the invite; the tenant must still accept on the public path.
      termsAcceptedAt: now.toISOString(),
      ownerTerms,
      awaitingPublicDepositPayment: true,
      capturedAt: now.toISOString(),
      source: 'owner_invite',
      contractPreference: input.contractPreference,
      tenantTermsAcceptedAt: null,
    };

    const inserted = await transaction
      .insert(reservations)
      .values({
        organizationId: preview.organizationId,
        unitId: input.unitId,
        tenantPartyId: party.id,
        status: 'pending',
        expiresAt,
        rentMinor: preview.rentMinor,
        currency: preview.currency,
        termsSnapshot: snapshot,
      })
      .returning({ id: reservations.id });

    const reservationId = inserted[0]!.id;
    await transaction.insert(workflowEvents).values({
      organizationId: preview.organizationId,
      actorUserId: claims.sub,
      resourceType: 'reservation',
      resourceId: reservationId,
      eventType: 'reservation.owner_invite_created',
      toStatus: 'pending',
      metadata: {
        referenceCode,
        mode: input.mode,
        contractPreference: input.contractPreference,
      },
    });

    const paymentPath = leasePaymentPath(input.locale, sessionReference, referenceCode);
    const paymentUrl = appLink(paymentPath);
    const unitLabel =
      input.locale === 'ar'
        ? preview.unitNameAr || preview.propertyNameAr
        : preview.unitNameEn || preview.propertyNameEn;
    const modeLabel =
      input.mode === 'sale'
        ? input.locale === 'ar'
          ? 'شراء'
          : 'purchase'
        : input.locale === 'ar'
          ? 'تأجير'
          : 'rent';

    await notifyByEmail({
      orgId: preview.organizationId,
      aggregateType: 'reservation',
      aggregateId: reservationId,
      dedupeKey: `owner-invite:${reservationId}:email`,
      audience: { parties: [party.id] },
      content: () => ({
        tone: 'booking',
        subject:
          input.locale === 'ar'
            ? `دعوة لإكمال حجز ${modeLabel} — ${unitLabel}`
            : `Complete your ${modeLabel} booking — ${unitLabel}`,
        title:
          input.locale === 'ar' ? 'أكمل حجزك على BHD R' : 'Complete your booking on BHD R',
        intro:
          input.locale === 'ar'
            ? `دعوة من المؤجر لإكمال حجز «${unitLabel}»: الموافقة على الشروط، دفع العربون، ورفع المستندات.`
            : `Your landlord invited you to complete “${unitLabel}”: accept terms, pay the deposit, and upload documents.`,
        details: [
          { label: input.locale === 'ar' ? 'المرجع' : 'Reference', value: referenceCode },
          {
            label: input.locale === 'ar' ? 'المستأجر' : 'Tenant',
            value: partyDisplayName(bookingParty) || fullName,
          },
        ],
        cta: {
          label: input.locale === 'ar' ? 'متابعة الحجز والدفع' : 'Continue booking & pay',
          url: paymentUrl,
        },
      }),
    });

    await notifyPartyWhatsApp({
      orgId: preview.organizationId,
      partyId: party.id,
      aggregateType: 'reservation',
      aggregateId: reservationId,
      dedupeKey: `owner-invite:${reservationId}:whatsapp`,
      draft: {
        tone: 'booking',
        recipientName: fullName,
        titleAr: 'أكمل حجزك على BHD R',
        titleEn: 'Complete your booking on BHD R',
        introAr: `دعوة من المؤجر لإكمال حجز «${unitLabel}» (مرجع ${referenceCode}).`,
        introEn: `Your landlord invited you to complete “${unitLabel}” (ref ${referenceCode}).`,
        linesAr: ['وافق على الشروط، ادفع العربون، ثم ارفع المستندات من الرابط.'],
        linesEn: ['Accept the terms, pay the deposit, then upload documents via the link.'],
        linkLabelAr: 'متابعة الحجز',
        linkLabelEn: 'Continue booking',
        link: paymentUrl,
      },
    });

    return {
      reservationId,
      referenceCode,
      sessionReference,
      amountMinor: depositMinor,
      currency: preview.currency,
      expiresAt: expiresAt.toISOString(),
      paymentPath,
      ownerPath: `/${input.locale}/owner/bookings/${reservationId}`,
      contractPreference: input.contractPreference,
      tenantName: partyDisplayName(bookingParty) || fullName,
    };
  });

  sendQueuedEmailsSoon();
  return result;
}

/** Owner-invite unpaid drafts still reserve the unit (unlike anonymous website checkouts). */
export function isOwnerInviteSnapshot(snapshot: unknown): boolean {
  return Boolean(
    snapshot &&
      typeof snapshot === 'object' &&
      (snapshot as { source?: string }).source === 'owner_invite',
  );
}
