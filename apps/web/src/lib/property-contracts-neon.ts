import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, lte, gte, ne, sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import { currencyMinorUnits, type CurrencyCode } from '@bhd-r/contracts';
import {
  approvalRequests,
  contractSignatures,
  contractTemplates,
  contracts,
  leases,
  memberships,
  outboxEvents,
  parties,
  partyRoles,
  properties,
  salesDeals,
  stayBookingGuests,
  stayBookingStatusHistory,
  stayBookings,
  stayInventoryLocks,
  units,
  users,
  workflowEvents,
} from '@bhd-r/db';
import { assertStayBookingTransition } from '@bhd-r/domain';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';
import {
  PublicStayBookingError,
  createLockInTransaction,
  isRangeAvailableInTransaction,
} from '@/lib/public-stays-booking-neon';

type Tx = Parameters<Parameters<typeof withinViewerTenant>[1]>[0];

/** Stay statuses that already mean "accepted" — a contract can be issued for them directly. */
const ACCEPTED_STAY_STATUSES = new Set([
  'confirmed',
  'pre_arrival',
  'checked_in',
  'checked_out',
  'closed',
]);
const PENDING_CONTRACT_STATUSES = ['draft', 'sent', 'partially_signed'] as const;

export type ContractOutcome = {
  contractId: string;
  contractReference: string;
  contractStatus: string;
  /** True when the viewer may not sign: the contract waits for the organization owner. */
  routedToManager: boolean;
  alreadyExisted?: boolean;
};

function fail(code: string): never {
  throw new Error(code);
}

function omanToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat' }).format(new Date());
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as T[];
}

function minorUnitsFor(currency: string): number {
  return currencyMinorUnits[currency as CurrencyCode] ?? 3;
}

/** "1250.5" → 1250500n for OMR. Rejects negatives, junk and excess precision. */
export function decimalToMinor(amount: string, currency: string): bigint {
  const digits = minorUnitsFor(currency);
  const trimmed = amount.trim().replace(/,/g, '');
  const match = /^(\d{1,12})(?:\.(\d+))?$/.exec(trimmed);
  if (!match) fail('invalid_amount');
  const fraction = match[2] ?? '';
  if (fraction.length > digits) fail('invalid_amount');
  return BigInt(match[1]! + fraction.padEnd(digits, '0'));
}

async function loadProperty(tx: Tx, claims: SessionClaims, propertyId: string) {
  const orgId = claims.organizationId ?? fail('organization_required');
  const ownerPartyId = ownerPartyScope(claims);
  const [property] = await tx
    .select({
      id: properties.id,
      ownerPartyId: properties.ownerPartyId,
      nameAr: properties.nameAr,
      nameEn: properties.nameEn,
      status: properties.status,
    })
    .from(properties)
    .where(
      and(
        eq(properties.id, propertyId),
        eq(properties.organizationId, orgId),
        ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
      ),
    )
    .limit(1);
  if (!property) fail('property_not_found');
  return { orgId, property };
}

async function loadUnit(tx: Tx, orgId: string, propertyId: string, unitId: string) {
  const [unit] = await tx
    .select({
      id: units.id,
      code: units.code,
      nameAr: units.nameAr,
      nameEn: units.nameEn,
      currency: units.currency,
      salePriceMinor: units.salePriceMinor,
    })
    .from(units)
    .where(
      and(eq(units.id, unitId), eq(units.organizationId, orgId), eq(units.propertyId, propertyId)),
    )
    .limit(1);
  return unit ?? fail('unit_not_found');
}

async function viewerIdentity(tx: Tx, claims: SessionClaims) {
  const [user] = await tx
    .select({ displayName: users.displayName, email: users.email })
    .from(users)
    .where(eq(users.id, claims.sub))
    .limit(1);
  return { userId: claims.sub, displayName: user?.displayName ?? null, email: user?.email ?? null };
}

/** Default contract wording; the binding details live in the contract payload snapshot. */
const DEFAULT_TEMPLATES = {
  lease_default:
    '<h1>عقد إيجار</h1><p>يُبرم هذا العقد بين المؤجر والمستأجر المذكورين في بيانات العقد لتأجير الوحدة المحددة فيه، للمدة وبالقيمة المبينتين، ويخضع للشروط والأحكام المعتمدة للعقار التي وافق عليها المستأجر.</p>',
  sale_default:
    '<h1>عقد بيع</h1><p>يُبرم هذا العقد بين البائع والمشتري المذكورين في بيانات العقد لبيع الوحدة المحددة فيه بالثمن المتفق عليه، وتنتقل الملكية وفق الإجراءات النظامية المعمول بها.</p>',
} as const;

async function ensureTemplate(tx: Tx, orgId: string, key: keyof typeof DEFAULT_TEMPLATES) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${orgId}:${key}:ar`}, 11))`,
  );
  const [existing] = await tx
    .select({ id: contractTemplates.id })
    .from(contractTemplates)
    .where(
      and(
        eq(contractTemplates.organizationId, orgId),
        eq(contractTemplates.key, key),
        eq(contractTemplates.language, 'ar'),
        eq(contractTemplates.active, true),
      ),
    )
    .limit(1);
  if (existing) return existing.id;
  const html = DEFAULT_TEMPLATES[key];
  const [versionRow] = rowsOf<{ version: number }>(
    await tx.execute(sql`
      select coalesce(max(version), 0)::integer + 1 as version
      from contract_templates
      where organization_id = ${orgId} and key = ${key} and language = 'ar'
    `),
  );
  const [created] = await tx
    .insert(contractTemplates)
    .values({
      organizationId: orgId,
      key,
      version: Number(versionRow?.version ?? 1),
      language: 'ar',
      html,
      contentHash: createHash('sha256').update(html).digest('hex'),
      active: true,
    })
    .returning({ id: contractTemplates.id });
  return created!.id;
}

async function allocateContractReference(tx: Tx, orgId: string, year: number): Promise<string> {
  const [row] = rowsOf<{ allocated: string | number | bigint }>(
    await tx.execute(sql`
      insert into contract_sequences (organization_id, year, next_value)
      values (${orgId}, ${year}, 2)
      on conflict (organization_id, year)
      do update set next_value = contract_sequences.next_value + 1
      returning next_value - 1 as allocated
    `),
  );
  return `CTR-${year}-${String(row!.allocated).padStart(6, '0')}`;
}

async function findOrCreateParty(
  tx: Tx,
  orgId: string,
  input: { displayName: string; email?: string | null; phone?: string | null },
  roleKey: 'tenant' | 'prospect',
  source: string,
): Promise<{ id: string; displayName: string }> {
  const email = input.email?.trim().toLowerCase() || null;
  if (email) {
    const [existing] = await tx
      .select({ id: parties.id, displayName: parties.displayName })
      .from(parties)
      .where(and(eq(parties.organizationId, orgId), sql`lower(${parties.email}) = ${email}`))
      .limit(1);
    if (existing) {
      await tx
        .insert(partyRoles)
        .values({ organizationId: orgId, partyId: existing.id, roleKey })
        .onConflictDoNothing();
      return existing;
    }
  }
  const [created] = await tx
    .insert(parties)
    .values({
      organizationId: orgId,
      type: 'person',
      displayName: input.displayName.trim().slice(0, 200),
      email,
      phone: input.phone?.trim().slice(0, 40) || null,
      metadata: { source },
    })
    .returning({ id: parties.id, displayName: parties.displayName });
  await tx
    .insert(partyRoles)
    .values({ organizationId: orgId, partyId: created!.id, roleKey })
    .onConflictDoNothing();
  return created!;
}

async function partyName(tx: Tx, partyId: string): Promise<string> {
  const [row] = await tx
    .select({ name: parties.displayName })
    .from(parties)
    .where(eq(parties.id, partyId))
    .limit(1);
  return row?.name ?? '';
}

/** Organization owner who decides contracts a non-signing user prepared. */
async function managerUserId(tx: Tx, orgId: string, excludeUserId: string): Promise<string | null> {
  const rows = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, orgId),
        eq(memberships.roleKey, 'organization_owner'),
        eq(memberships.status, 'active'),
      ),
    )
    .orderBy(asc(memberships.createdAt));
  return rows.find((row) => row.userId !== excludeUserId)?.userId ?? rows[0]?.userId ?? null;
}

function signatureHash(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/** The system signs for the owner, in the name of the approving user. */
async function signForOwner(
  tx: Tx,
  input: {
    orgId: string;
    contractId: string;
    ownerPartyId: string;
    viewer: Awaited<ReturnType<typeof viewerIdentity>>;
    roles: readonly string[];
    signedAt: Date;
  },
) {
  await tx
    .insert(contractSignatures)
    .values({
      organizationId: input.orgId,
      contractId: input.contractId,
      signerPartyId: input.ownerPartyId,
      signerRole: 'owner',
      method: 'system_on_approval',
      evidence: {
        signedByUserId: input.viewer.userId,
        signedByName: input.viewer.displayName,
        signedByEmail: input.viewer.email,
        signedByRoles: input.roles,
        onBehalfOf: 'owner',
      },
      signatureHash: signatureHash([
        input.contractId,
        input.ownerPartyId,
        input.viewer.userId,
        input.signedAt.toISOString(),
      ]),
      signedAt: input.signedAt,
    })
    .onConflictDoNothing();
}

type CounterpartySignature = {
  partyId: string;
  method: string;
  evidence: Record<string, unknown>;
  signedAt: Date;
};

/**
 * Contract (+ lease for rentals) in one go. A viewer holding contract.sign gets the
 * contract signed for the owner immediately; anyone else leaves it waiting for the owner.
 */
async function issueContract(
  tx: Tx,
  input: {
    claims: SessionClaims;
    orgId: string;
    property: { id: string; ownerPartyId: string; nameAr: string; nameEn: string };
    unit: { id: string; code: string; nameAr: string; nameEn: string };
    counterparty: { id: string; displayName: string };
    type: 'lease' | 'sale';
    startsOn: string;
    endsOn: string | null;
    amountMinor: bigint;
    depositMinor: bigint | null;
    currency: string;
    source: Record<string, unknown>;
    extra?: Record<string, unknown>;
    counterpartySignature?: CounterpartySignature | null;
  },
): Promise<ContractOutcome & { leaseId: string | null }> {
  const { claims, orgId, property, unit } = input;
  const canSign = hasPermission(claims, 'contract.sign');
  const viewer = await viewerIdentity(tx, claims);
  const now = new Date();
  const templateId = await ensureTemplate(
    tx,
    orgId,
    input.type === 'sale' ? 'sale_default' : 'lease_default',
  );
  const reference = await allocateContractReference(tx, orgId, Number(input.startsOn.slice(0, 4)));
  const ownerName = await partyName(tx, property.ownerPartyId);
  const status = canSign ? 'signed' : 'sent';

  const [contract] = await tx
    .insert(contracts)
    .values({
      organizationId: orgId,
      reference,
      templateVersionId: templateId,
      unitId: unit.id,
      ownerPartyId: property.ownerPartyId,
      tenantPartyId: input.counterparty.id,
      status,
      sentAt: now,
      completedAt: canSign ? now : null,
      payloadSnapshot: {
        contract: { reference, type: input.type },
        source: input.source,
        owner: { id: property.ownerPartyId, displayName: ownerName },
        [input.type === 'sale' ? 'buyer' : 'tenant']: input.counterparty,
        property: { id: property.id, nameAr: property.nameAr, nameEn: property.nameEn },
        unit,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        amount: { amountMinor: input.amountMinor.toString(), currency: input.currency },
        deposit: input.depositMinor
          ? { amountMinor: input.depositMinor.toString(), currency: input.currency }
          : null,
        approval: {
          mode: canSign ? 'signed_on_approval' : 'awaiting_manager',
          byUserId: viewer.userId,
          byName: viewer.displayName,
          at: now.toISOString(),
        },
        ...input.extra,
      },
    })
    .returning({ id: contracts.id });
  const contractId = contract!.id;

  if (input.counterpartySignature) {
    const signature = input.counterpartySignature;
    await tx
      .insert(contractSignatures)
      .values({
        organizationId: orgId,
        contractId,
        signerPartyId: signature.partyId,
        signerRole: input.type === 'sale' ? 'buyer' : 'tenant',
        method: signature.method,
        evidence: signature.evidence,
        signatureHash: signatureHash([
          contractId,
          signature.partyId,
          signature.method,
          signature.signedAt.toISOString(),
        ]),
        signedAt: signature.signedAt,
      })
      .onConflictDoNothing();
  }
  if (canSign) {
    await signForOwner(tx, {
      orgId,
      contractId,
      ownerPartyId: property.ownerPartyId,
      viewer,
      roles: claims.roles,
      signedAt: now,
    });
  }

  let leaseId: string | null = null;
  if (input.type === 'lease' && input.endsOn) {
    const [lease] = await tx
      .insert(leases)
      .values({
        organizationId: orgId,
        contractId,
        unitId: unit.id,
        ownerPartyId: property.ownerPartyId,
        tenantPartyId: input.counterparty.id,
        status: canSign ? 'active' : 'draft',
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        rentMinor: input.amountMinor,
        depositMinor: input.depositMinor,
        currency: input.currency,
        minorUnit: minorUnitsFor(input.currency),
        billingDay: Math.min(Number(input.startsOn.slice(8, 10)), 28),
      })
      .returning({ id: leases.id });
    leaseId = lease!.id;
  }

  if (!canSign) {
    await tx.insert(approvalRequests).values({
      organizationId: orgId,
      reference: `APR-${reference}`,
      type: 'contract_approval',
      subject: `Contract approval · ${reference}`,
      resourceType: 'contract',
      resourceId: contractId,
      requestedByUserId: claims.sub,
      assignedToUserId: await managerUserId(tx, orgId, claims.sub),
      status: 'pending',
    });
  }

  await tx.insert(workflowEvents).values({
    organizationId: orgId,
    actorUserId: claims.sub,
    resourceType: 'contract',
    resourceId: contractId,
    eventType: canSign ? 'contract.signed' : 'contract.approval_requested',
    toStatus: status,
    metadata: { reference, type: input.type, source: input.source, leaseId },
  });
  await tx.insert(outboxEvents).values({
    organizationId: orgId,
    topic: input.type === 'sale' ? 'sale_contract.created' : 'lease.created',
    aggregateType: 'contract',
    aggregateId: contractId,
    payload: { contractId, reference, unitId: unit.id, leaseId, status },
  });

  return {
    contractId,
    contractReference: reference,
    contractStatus: status,
    routedToManager: !canSign,
    leaseId,
  };
}

function snapshotObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

type StayType = 'overnight_stay' | 'day_use' | 'overnight_only';

function stayTypeOf(snapshot: Record<string, unknown>): StayType {
  const value = snapshot.stayType;
  return value === 'day_use' || value === 'overnight_only' ? value : 'overnight_stay';
}

async function existingBookingContract(tx: Tx, orgId: string, bookingId: string) {
  const [row] = await tx
    .select({ id: contracts.id, reference: contracts.reference, status: contracts.status })
    .from(contracts)
    .where(
      and(
        eq(contracts.organizationId, orgId),
        sql`${contracts.payloadSnapshot}->'source'->>'stayBookingId' = ${bookingId}`,
        ne(contracts.status, 'void'),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Owner approves a stay booking: a pending request is confirmed (dates re-checked and
 * locked), then the booking becomes a contract and a lease for the stay dates.
 */
export async function approveStayBookingOnNeon(
  claims: SessionClaims,
  propertyId: string,
  bookingId: string,
): Promise<ContractOutcome & { bookingStatus: string }> {
  if (!hasPermission(claims, 'stay.booking.manage') || !hasPermission(claims, 'contract.create')) {
    fail('forbidden');
  }
  return withinViewerTenant(claims, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${bookingId}, 29))`);
    const { orgId, property } = await loadProperty(tx, claims, propertyId);
    const [booking] = await tx
      .select({
        id: stayBookings.id,
        referenceCode: stayBookings.referenceCode,
        unitId: stayBookings.unitId,
        status: stayBookings.status,
        guestPartyId: stayBookings.guestPartyId,
        checkInOn: stayBookings.checkInOn,
        checkOutOn: stayBookings.checkOutOn,
        totalMinor: stayBookings.totalMinor,
        currency: stayBookings.currency,
        createdAt: stayBookings.createdAt,
        snapshot: stayBookings.pricingSnapshotJson,
      })
      .from(stayBookings)
      .where(
        and(
          eq(stayBookings.id, bookingId),
          eq(stayBookings.organizationId, orgId),
          eq(stayBookings.propertyId, property.id),
        ),
      )
      .limit(1);
    if (!booking) fail('booking_not_found');

    const existing = await existingBookingContract(tx, orgId, booking.id);
    if (existing && booking.status !== 'request_pending') {
      return {
        bookingStatus: booking.status,
        contractId: existing.id,
        contractReference: existing.reference ?? existing.id.slice(0, 8).toUpperCase(),
        contractStatus: existing.status,
        routedToManager: existing.status !== 'signed',
        alreadyExisted: true,
      };
    }

    const snapshot = snapshotObject(booking.snapshot);
    const stayType = stayTypeOf(snapshot);
    const viewer = await viewerIdentity(tx, claims);
    const now = new Date();
    let bookingStatus = booking.status;

    if (booking.status === 'request_pending') {
      if (!assertStayBookingTransition('request_pending', 'confirmed').ok)
        fail('booking_not_approvable');
      const free = await isRangeAvailableInTransaction(
        tx,
        orgId,
        booking.unitId,
        booking.checkInOn,
        booking.checkOutOn,
        stayType,
        booking.id,
      );
      if (!free) fail('dates_unavailable');
      let lockId: string;
      try {
        ({ id: lockId } = await createLockInTransaction(tx, {
          organizationId: orgId,
          unitId: booking.unitId,
          checkInOn: booking.checkInOn,
          checkOutOn: booking.checkOutOn,
          kind: 'booking',
          lockSlot:
            stayType === 'day_use' ? 'morning' : stayType === 'overnight_only' ? 'evening' : 'full',
          sourceType: 'stay_booking',
          sourceId: booking.id,
          note: `Approved request ${booking.referenceCode}`,
        }));
      } catch (error) {
        if (error instanceof PublicStayBookingError && error.code === 'dates_unavailable') {
          fail('dates_unavailable');
        }
        throw error;
      }
      await tx
        .update(stayBookings)
        .set({ status: 'confirmed', inventoryLockId: lockId, updatedAt: now })
        .where(and(eq(stayBookings.id, booking.id), eq(stayBookings.organizationId, orgId)));
      await tx.insert(stayBookingStatusHistory).values({
        organizationId: orgId,
        bookingId: booking.id,
        fromStatus: 'request_pending',
        toStatus: 'confirmed',
        actorUserId: claims.sub,
        reason: 'Owner approved booking request',
        metadataJson: { approvedBy: viewer.displayName, approvedByUserId: viewer.userId },
      });
      await tx.insert(workflowEvents).values({
        organizationId: orgId,
        actorUserId: claims.sub,
        resourceType: 'stay_booking',
        resourceId: booking.id,
        eventType: 'stay.booking.confirmed',
        fromStatus: 'request_pending',
        toStatus: 'confirmed',
        metadata: { referenceCode: booking.referenceCode, approvedBy: viewer.displayName },
      });
      bookingStatus = 'confirmed';
    } else if (!ACCEPTED_STAY_STATUSES.has(booking.status)) {
      fail('booking_not_approvable');
    }

    if (existing) {
      return {
        bookingStatus,
        contractId: existing.id,
        contractReference: existing.reference ?? existing.id.slice(0, 8).toUpperCase(),
        contractStatus: existing.status,
        routedToManager: existing.status !== 'signed',
        alreadyExisted: true,
      };
    }

    const contact = snapshotObject(snapshot.guestContact);
    let tenant: { id: string; displayName: string };
    if (booking.guestPartyId) {
      tenant = { id: booking.guestPartyId, displayName: await partyName(tx, booking.guestPartyId) };
    } else {
      const [primaryGuest] = await tx
        .select({ name: stayBookingGuests.displayName })
        .from(stayBookingGuests)
        .where(
          and(eq(stayBookingGuests.bookingId, booking.id), eq(stayBookingGuests.isPrimary, true)),
        )
        .limit(1);
      const displayName =
        (typeof contact.displayName === 'string' && contact.displayName.trim()) ||
        primaryGuest?.name?.trim() ||
        `Guest ${booking.referenceCode}`;
      tenant = await findOrCreateParty(
        tx,
        orgId,
        {
          displayName,
          email: typeof contact.email === 'string' ? contact.email : null,
          phone: typeof contact.phone === 'string' ? contact.phone : null,
        },
        'tenant',
        'stay_booking',
      );
      await tx
        .update(stayBookings)
        .set({ guestPartyId: tenant.id, updatedAt: now })
        .where(and(eq(stayBookings.id, booking.id), eq(stayBookings.organizationId, orgId)));
    }

    const acceptedTerms = snapshotObject(snapshot.acceptedTerms);
    const acceptedAt =
      typeof acceptedTerms.acceptedAt === 'string' ? new Date(acceptedTerms.acceptedAt) : null;
    const counterpartySignature: CounterpartySignature = acceptedAt
      ? {
          partyId: tenant.id,
          method: 'booking_terms_acceptance',
          evidence: {
            bookingReference: booking.referenceCode,
            acceptedTerms,
            guestContact: contact,
          },
          signedAt: acceptedAt,
        }
      : {
          partyId: tenant.id,
          method: 'booking_confirmation',
          evidence: {
            bookingReference: booking.referenceCode,
            bookingStatus,
            guestContact: contact,
          },
          signedAt: booking.createdAt,
        };

    const unit = await loadUnit(tx, orgId, property.id, booking.unitId);
    const endsOn =
      booking.checkOutOn > booking.checkInOn ? booking.checkOutOn : addDays(booking.checkInOn, 1);
    const outcome = await issueContract(tx, {
      claims,
      orgId,
      property,
      unit: { id: unit.id, code: unit.code, nameAr: unit.nameAr, nameEn: unit.nameEn },
      counterparty: tenant,
      type: 'lease',
      startsOn: booking.checkInOn,
      endsOn,
      amountMinor: booking.totalMinor,
      depositMinor: null,
      currency: booking.currency,
      source: {
        type: 'stay_booking',
        stayBookingId: booking.id,
        referenceCode: booking.referenceCode,
      },
      extra: { stayType },
      counterpartySignature,
    });
    return { bookingStatus, ...outcome };
  });
}

/** Owner turns down a pending stay request and frees its dates. */
export async function rejectStayBookingOnNeon(
  claims: SessionClaims,
  propertyId: string,
  bookingId: string,
): Promise<{ bookingStatus: string }> {
  if (!hasPermission(claims, 'stay.booking.manage')) fail('forbidden');
  return withinViewerTenant(claims, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${bookingId}, 29))`);
    const { orgId, property } = await loadProperty(tx, claims, propertyId);
    const [booking] = await tx
      .select({
        id: stayBookings.id,
        status: stayBookings.status,
        inventoryLockId: stayBookings.inventoryLockId,
        referenceCode: stayBookings.referenceCode,
      })
      .from(stayBookings)
      .where(
        and(
          eq(stayBookings.id, bookingId),
          eq(stayBookings.organizationId, orgId),
          eq(stayBookings.propertyId, property.id),
        ),
      )
      .limit(1);
    if (!booking) fail('booking_not_found');
    if (booking.status !== 'request_pending') fail('booking_not_approvable');
    const now = new Date();
    await tx
      .update(stayBookings)
      .set({ status: 'cancelled', updatedAt: now })
      .where(and(eq(stayBookings.id, booking.id), eq(stayBookings.organizationId, orgId)));
    if (booking.inventoryLockId) {
      await tx
        .update(stayInventoryLocks)
        .set({ status: 'released', updatedAt: now })
        .where(
          and(
            eq(stayInventoryLocks.id, booking.inventoryLockId),
            eq(stayInventoryLocks.organizationId, orgId),
          ),
        );
    }
    await tx.insert(stayBookingStatusHistory).values({
      organizationId: orgId,
      bookingId: booking.id,
      fromStatus: 'request_pending',
      toStatus: 'cancelled',
      actorUserId: claims.sub,
      reason: 'Owner rejected booking request',
    });
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'stay_booking',
      resourceId: booking.id,
      eventType: 'stay.cancelled',
      fromStatus: 'request_pending',
      toStatus: 'cancelled',
      metadata: { referenceCode: booking.referenceCode, reason: 'owner_rejected' },
    });
    return { bookingStatus: 'cancelled' };
  });
}

/** Manager (contract.sign) approves a contract someone without signing rights prepared. */
export async function approveContractOnNeon(
  claims: SessionClaims,
  propertyId: string,
  contractId: string,
): Promise<ContractOutcome> {
  if (!hasPermission(claims, 'contract.sign')) fail('forbidden');
  return withinViewerTenant(claims, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${contractId}, 31))`);
    const { orgId, property } = await loadProperty(tx, claims, propertyId);
    const [contract] = await tx
      .select({
        id: contracts.id,
        reference: contracts.reference,
        status: contracts.status,
        ownerPartyId: contracts.ownerPartyId,
        type: sql<string | null>`${contracts.payloadSnapshot}->'contract'->>'type'`,
        saleDealId: sql<string | null>`${contracts.payloadSnapshot}->'sale'->>'dealId'`,
      })
      .from(contracts)
      .innerJoin(units, eq(units.id, contracts.unitId))
      .where(
        and(
          eq(contracts.id, contractId),
          eq(contracts.organizationId, orgId),
          eq(units.propertyId, property.id),
        ),
      )
      .limit(1);
    if (!contract) fail('contract_not_found');
    const reference = contract.reference ?? contract.id.slice(0, 8).toUpperCase();
    if (contract.status === 'signed') {
      return {
        contractId: contract.id,
        contractReference: reference,
        contractStatus: 'signed',
        routedToManager: false,
        alreadyExisted: true,
      };
    }
    if (!(PENDING_CONTRACT_STATUSES as readonly string[]).includes(contract.status)) {
      fail('contract_not_pending');
    }

    const now = new Date();
    const viewer = await viewerIdentity(tx, claims);
    await signForOwner(tx, {
      orgId,
      contractId: contract.id,
      ownerPartyId: contract.ownerPartyId,
      viewer,
      roles: claims.roles,
      signedAt: now,
    });
    await tx
      .update(contracts)
      .set({ status: 'signed', completedAt: now, updatedAt: now })
      .where(and(eq(contracts.id, contract.id), eq(contracts.organizationId, orgId)));
    await tx
      .update(leases)
      .set({ status: 'active', updatedAt: now })
      .where(
        and(
          eq(leases.organizationId, orgId),
          eq(leases.contractId, contract.id),
          eq(leases.status, 'draft'),
        ),
      );
    if (contract.type === 'sale' && contract.saleDealId) {
      await tx
        .update(salesDeals)
        .set({ status: 'closed_won', closedOn: omanToday(), updatedAt: now })
        .where(and(eq(salesDeals.id, contract.saleDealId), eq(salesDeals.organizationId, orgId)));
    }
    await tx
      .update(approvalRequests)
      .set({
        status: 'approved',
        decidedAt: now,
        decisionNote: `Approved by ${viewer.displayName ?? viewer.userId}`,
        updatedAt: now,
      })
      .where(
        and(
          eq(approvalRequests.organizationId, orgId),
          eq(approvalRequests.resourceType, 'contract'),
          eq(approvalRequests.resourceId, contract.id),
          inArray(approvalRequests.status, ['pending', 'on_hold']),
        ),
      );
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'contract',
      resourceId: contract.id,
      eventType: 'contract.signed',
      fromStatus: contract.status,
      toStatus: 'signed',
      metadata: { reference, approvedBy: viewer.displayName },
    });
    return {
      contractId: contract.id,
      contractReference: reference,
      contractStatus: 'signed',
      routedToManager: false,
    };
  });
}

export type ManualLeaseInput = {
  unitId: string;
  partyName: string;
  partyEmail?: string | undefined;
  partyPhone?: string | undefined;
  startsOn: string;
  endsOn: string;
  amount: string;
  deposit?: string | undefined;
  notes?: string | undefined;
};

export async function createManualLeaseContractOnNeon(
  claims: SessionClaims,
  propertyId: string,
  input: ManualLeaseInput,
): Promise<ContractOutcome> {
  if (!hasPermission(claims, 'contract.create') || !hasPermission(claims, 'lease.create')) {
    fail('forbidden');
  }
  if (input.endsOn <= input.startsOn) fail('invalid_dates');
  return withinViewerTenant(claims, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.unitId}::text))`);
    const { orgId, property } = await loadProperty(tx, claims, propertyId);
    const unit = await loadUnit(tx, orgId, property.id, input.unitId);
    const [overlap] = await tx
      .select({ id: leases.id })
      .from(leases)
      .where(
        and(
          eq(leases.organizationId, orgId),
          eq(leases.unitId, unit.id),
          inArray(leases.status, ['draft', 'active', 'cancel_requested', 'clearance_pending']),
          lte(leases.startsOn, addDays(input.endsOn, -1)),
          gte(leases.endsOn, addDays(input.startsOn, 1)),
        ),
      )
      .limit(1);
    if (overlap) fail('lease_overlap');
    const amountMinor = decimalToMinor(input.amount, unit.currency);
    if (amountMinor <= 0n) fail('invalid_amount');
    const depositMinor = input.deposit?.trim()
      ? decimalToMinor(input.deposit, unit.currency)
      : null;
    const tenant = await findOrCreateParty(
      tx,
      orgId,
      {
        displayName: input.partyName,
        email: input.partyEmail ?? null,
        phone: input.partyPhone ?? null,
      },
      'tenant',
      'manual_contract',
    );
    return issueContract(tx, {
      claims,
      orgId,
      property,
      unit: { id: unit.id, code: unit.code, nameAr: unit.nameAr, nameEn: unit.nameEn },
      counterparty: tenant,
      type: 'lease',
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      amountMinor,
      depositMinor,
      currency: unit.currency,
      source: { type: 'manual' },
      extra: input.notes?.trim() ? { notes: input.notes.trim().slice(0, 2000) } : {},
    });
  });
}

export type ManualSaleInput = {
  unitId: string;
  partyName: string;
  partyEmail?: string | undefined;
  partyPhone?: string | undefined;
  signedOn: string;
  amount: string;
  notes?: string | undefined;
};

export async function createManualSaleContractOnNeon(
  claims: SessionClaims,
  propertyId: string,
  input: ManualSaleInput,
): Promise<ContractOutcome> {
  if (!hasPermission(claims, 'contract.create') || !hasPermission(claims, 'sale.manage')) {
    fail('forbidden');
  }
  return withinViewerTenant(claims, async (tx) => {
    const { orgId, property } = await loadProperty(tx, claims, propertyId);
    const unit = await loadUnit(tx, orgId, property.id, input.unitId);
    const priceMinor = decimalToMinor(input.amount, unit.currency);
    if (priceMinor <= 0n) fail('invalid_amount');
    const buyer = await findOrCreateParty(
      tx,
      orgId,
      {
        displayName: input.partyName,
        email: input.partyEmail ?? null,
        phone: input.partyPhone ?? null,
      },
      'prospect',
      'manual_sale_contract',
    );
    const canSign = hasPermission(claims, 'contract.sign');
    const notes = input.notes?.trim().slice(0, 2000) || null;
    const [deal] = await tx
      .insert(salesDeals)
      .values({
        organizationId: orgId,
        reference: `SALE-${input.signedOn.slice(0, 4)}-${randomUUID().slice(0, 8).toUpperCase()}`,
        propertyId: property.id,
        unitId: unit.id,
        sellerPartyId: property.ownerPartyId,
        buyerPartyId: buyer.id,
        assignedToUserId: claims.sub,
        status: canSign ? 'closed_won' : 'contracting',
        askingPriceMinor: unit.salePriceMinor ?? priceMinor,
        agreedPriceMinor: priceMinor,
        currency: unit.currency,
        minorUnit: minorUnitsFor(unit.currency),
        closedOn: canSign ? input.signedOn : null,
        notes,
      })
      .returning({ id: salesDeals.id, reference: salesDeals.reference });
    return issueContract(tx, {
      claims,
      orgId,
      property,
      unit: { id: unit.id, code: unit.code, nameAr: unit.nameAr, nameEn: unit.nameEn },
      counterparty: buyer,
      type: 'sale',
      startsOn: input.signedOn,
      endsOn: null,
      amountMinor: priceMinor,
      depositMinor: null,
      currency: unit.currency,
      source: { type: 'manual' },
      extra: {
        sale: { dealId: deal!.id, dealReference: deal!.reference },
        ...(notes ? { notes } : {}),
      },
    });
  });
}
