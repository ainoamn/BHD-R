import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, lte, gte, ne, sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import { currencyMinorUnits, type CurrencyCode } from '@bhd-r/contracts';
import {
  approvalRequests,
  cheques,
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
  stayProfiles,
  units,
  users,
  workflowEvents,
} from '@bhd-r/db';
import { assertStayBookingTransition } from '@bhd-r/domain';
import {
  DEFAULT_CONTRACT_TEMPLATES,
  type DefaultContractTemplateKey,
} from '@/lib/contract-default-templates';
import { appLink, notifyByEmail, notifyInTx } from '@/lib/email-notify';
import { formatMoney } from '@/lib/format';
import { computeLeaseTerms, type LeaseTermsDraft } from '@/lib/lease-terms';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';
import {
  PublicStayBookingError,
  createLockInTransaction,
  isRangeAvailableInTransaction,
} from '@/lib/public-stays-booking-neon';
import { resolveStayPeriodTimes } from '@/lib/stay-period-times';

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

async function ensureTemplate(tx: Tx, orgId: string, key: DefaultContractTemplateKey) {
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
  const html = DEFAULT_CONTRACT_TEMPLATES[key].ar;
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
  input: {
    displayName: string;
    email?: string | null;
    phone?: string | null;
    type?: 'person' | 'company';
  },
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
      type: input.type ?? 'person',
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

export type CounterpartySignature = {
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
    /** Lease rent per month when it differs from the contract amount (manual leases). */
    leaseRentMinor?: bigint;
    billingDay?: number;
    depositMinor: bigint | null;
    currency: string;
    source: Record<string, unknown>;
    extra?: Record<string, unknown>;
    counterpartySignature?: CounterpartySignature | null;
    /** Owner signs now; the contract waits for the tenant or buyer to sign it themself. */
    awaitCounterparty?: boolean;
  },
): Promise<ContractOutcome & { leaseId: string | null }> {
  const { claims, orgId, property, unit } = input;
  const canSign = hasPermission(claims, 'contract.sign');
  const awaiting = Boolean(input.awaitCounterparty);
  if (awaiting && !canSign) fail('forbidden');
  const viewer = await viewerIdentity(tx, claims);
  const now = new Date();
  const templateId = await ensureTemplate(
    tx,
    orgId,
    input.type === 'sale' ? 'sale_default' : 'lease_default',
  );
  const reference = await allocateContractReference(tx, orgId, Number(input.startsOn.slice(0, 4)));
  const ownerName = await partyName(tx, property.ownerPartyId);
  const status = awaiting ? 'partially_signed' : canSign ? 'signed' : 'sent';
  const fullySigned = status === 'signed';

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
      completedAt: fullySigned ? now : null,
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
          mode: awaiting
            ? 'awaiting_counterparty'
            : canSign
              ? 'signed_on_approval'
              : 'awaiting_manager',
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
        status: fullySigned ? 'active' : 'draft',
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        rentMinor: input.leaseRentMinor ?? input.amountMinor,
        depositMinor: input.depositMinor,
        currency: input.currency,
        minorUnit: minorUnitsFor(input.currency),
        billingDay: Math.min(input.billingDay ?? Number(input.startsOn.slice(8, 10)), 28),
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
    eventType: awaiting
      ? 'contract.awaiting_counterparty'
      : canSign
        ? 'contract.signed'
        : 'contract.approval_requested',
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

  const kind = input.type === 'sale' ? 'عقد البيع' : 'عقد الإيجار';
  const details = [
    { label: 'رقم العقد', value: reference },
    { label: 'العقار', value: `${property.nameAr} — ${unit.nameAr || unit.code}` },
    { label: 'تاريخ البداية', value: arDate(input.startsOn) },
    ...(input.endsOn ? [{ label: 'تاريخ النهاية', value: arDate(input.endsOn) }] : []),
    {
      label: input.type === 'sale' ? 'قيمة البيع' : 'قيمة الإيجار',
      value: formatMoney(
        (input.leaseRentMinor ?? input.amountMinor).toString(),
        input.currency,
        'ar',
      ),
    },
  ];
  const contractLink = appLink(
    input.type === 'sale' ? '/ar/account' : `/ar/tenant/contracts/${contractId}`,
  );
  await notifyInTx(tx, {
    orgId,
    aggregateType: 'contract',
    aggregateId: contractId,
    audience: { parties: [input.counterparty.id] },
    content: () =>
      awaiting
        ? {
            tone: 'contract',
            subject: `✍️ ${kind} ${reference} جاهز لتوقيعك`,
            title: `${kind} بانتظار توقيعك`,
            intro: `وقّع المالك ${kind}، وبقي توقيعك ليصبح سارياً.`,
            details,
            lines: ['راجع البنود على مهل، ثم وقّع من حسابك. لا حاجة لقلم، فقط إصبعك 😉'],
            cta: { label: 'مراجعة العقد وتوقيعه', url: contractLink },
          }
        : fullySigned
          ? {
              tone: 'contract',
              subject: `🎉 ${kind} ${reference} أصبح سارياً`,
              title: `مبروك! ${kind} موقّع وساري المفعول`,
              intro: `اكتملت التواقيع على ${kind}، وهذه أبرز تفاصيله:`,
              details,
              cta: { label: 'عرض العقد', url: contractLink },
            }
          : null,
  });
  await notifyInTx(tx, {
    orgId,
    aggregateType: 'contract',
    aggregateId: contractId,
    audience: canSign
      ? { parties: [property.ownerPartyId] }
      : { managersOf: { orgId, propertyId: property.id } },
    content: () => ({
      tone: 'contract',
      subject: canSign
        ? `📜 ${kind} جديد ${reference} — ${input.counterparty.displayName}`
        : `⏳ ${kind} ${reference} بانتظار اعتمادك`,
      title: canSign ? `صدر ${kind} جديد على عقارك` : `${kind} ينتظر اعتمادك`,
      intro: canSign
        ? `صدر ${kind} مع ${input.counterparty.displayName}${awaiting ? '، وينتظر توقيع الطرف الآخر' : ''}.`
        : `أنشأ ${viewer.displayName ?? 'أحد أعضاء الفريق'} ${kind} مع ${input.counterparty.displayName}، ويحتاج اعتماد صاحب الصلاحية.`,
      details,
      cta: { label: 'فتح العقد', url: appLink(`/ar/owner/contracts/${contractId}`) },
    }),
  });

  return {
    contractId,
    contractReference: reference,
    contractStatus: status,
    routedToManager: !canSign,
    leaseId,
  };
}

function arDate(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split('-').reverse().join('/') : iso;
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
        isNull(contracts.parentContractId),
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
        stayProfileId: stayBookings.stayProfileId,
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
    const [profileTimes] = booking.stayProfileId
      ? await tx
          .select({
            checkInFrom: stayProfiles.checkInFrom,
            dayUseCheckInFrom: stayProfiles.dayUseCheckInFrom,
            dayUseCheckOutUntil: stayProfiles.dayUseCheckOutUntil,
            overnightCheckOutUntil: stayProfiles.overnightCheckOutUntil,
            checkOutUntil: stayProfiles.checkOutUntil,
          })
          .from(stayProfiles)
          .where(
            and(
              eq(stayProfiles.id, booking.stayProfileId),
              eq(stayProfiles.organizationId, orgId),
            ),
          )
          .limit(1)
      : [null];
    const period = resolveStayPeriodTimes(stayType, profileTimes ?? {});
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
      extra: {
        stayType,
        checkInTime: period.checkInTime,
        checkOutTime: period.checkOutTime,
      },
      counterpartySignature,
    });
    await notifyInTx(tx, {
      orgId,
      aggregateType: 'stay_booking',
      aggregateId: booking.id,
      audience: { parties: [tenant.id] },
      content: () => ({
        tone: 'booking',
        subject: `🌴 تأكّد حجزك ${booking.referenceCode} في ${property.nameAr}`,
        title: 'حجزك مؤكد، فجهّز حقيبتك!',
        intro: `وافق المضيف على حجزك في ${property.nameAr}.`,
        details: [
          { label: 'رقم الحجز', value: booking.referenceCode },
          { label: 'العقار', value: `${property.nameAr} — ${unit.nameAr || unit.code}` },
          {
            label: 'الوصول',
            value: `${arDate(booking.checkInOn)} · ${period.checkInTime}`,
          },
          {
            label: 'المغادرة',
            value: `${arDate(stayType === 'day_use' ? booking.checkInOn : booking.checkOutOn)} · ${period.checkOutTime}`,
          },
          {
            label: 'الإجمالي',
            value: formatMoney(booking.totalMinor.toString(), booking.currency, 'ar'),
          },
        ],
        cta: { label: 'تفاصيل الحجز', url: appLink(`/ar/guest/stays/${booking.id}`) },
      }),
    });
    return { bookingStatus, ...outcome };
  });
}

/** Owner turns down a pending stay request and frees its dates. */
export async function rejectStayBookingOnNeon(
  claims: SessionClaims,
  propertyId: string,
  bookingId: string,
  input: {
    note?: string | null | undefined;
    refundDecision?: 'refund' | 'keep' | null | undefined;
  } = {},
): Promise<{ bookingStatus: string }> {
  const { cancelOwnerStayBookingOnNeon } = await import('@/lib/owner-stay-cancel-neon');
  const result = await cancelOwnerStayBookingOnNeon(claims, bookingId, {
    note: input.note ?? null,
    noteRequired: false,
    refundDecision: input.refundDecision ?? null,
    propertyId,
    onlyStatuses: ['request_pending'],
  });
  return { bookingStatus: result.status };
}

/** Owner approves a guest's pending date/period change. */
export async function approveGuestRescheduleOnNeon(
  claims: SessionClaims,
  propertyId: string,
  bookingId: string,
): Promise<{
  bookingStatus: string;
  applied: boolean;
  awaitsGuestPayment: boolean;
  paymentRedirectUrl?: string;
}> {
  if (!hasPermission(claims, 'stay.booking.manage')) fail('forbidden');
  const {
    applyStoredPendingRescheduleInTx,
    createRescheduleTopUpPaymentInTx,
  } = await import('@/lib/public-stays-guest-neon');
  return withinViewerTenant(claims, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${bookingId}, 29))`);
    const { orgId, property } = await loadProperty(tx, claims, propertyId);
    const [booking] = await tx
      .select()
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
    const snapshot =
      booking.pricingSnapshotJson && typeof booking.pricingSnapshotJson === 'object'
        ? (booking.pricingSnapshotJson as Record<string, unknown>)
        : null;
    const pending =
      snapshot?.pendingReschedule && typeof snapshot.pendingReschedule === 'object'
        ? (snapshot.pendingReschedule as Record<string, unknown>)
        : null;
    if (!pending || pending.status !== 'awaiting_owner') fail('reschedule_not_pending');

    const extraDue =
      typeof pending.extraDueMinor === 'string' && /^\d+$/.test(pending.extraDueMinor)
        ? BigInt(pending.extraDueMinor)
        : 0n;
    if (extraDue > 0n) {
      const stayType =
        pending.stayType === 'day_use' || pending.stayType === 'overnight_only'
          ? pending.stayType
          : 'overnight_stay';
      const checkInOn = typeof pending.checkInOn === 'string' ? pending.checkInOn : null;
      const checkOutOn = typeof pending.checkOutOn === 'string' ? pending.checkOutOn : null;
      if (!checkInOn || !checkOutOn) fail('reschedule_not_pending');
      const payment = await createRescheduleTopUpPaymentInTx(
        tx,
        booking,
        {
          ...pending,
          status: 'awaiting_guest_payment',
          checkInOn,
          checkOutOn,
          stayType,
          extraDueMinor: pending.extraDueMinor as string,
        },
        'ar',
      );
      await tx.insert(stayBookingStatusHistory).values({
        organizationId: orgId,
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: booking.status,
        actorUserId: claims.sub,
        reason: 'owner_approved_reschedule_awaiting_payment',
        metadataJson: pending,
      });
      return {
        bookingStatus: booking.status,
        applied: false,
        awaitsGuestPayment: true,
        paymentRedirectUrl: payment.redirectUrl,
      };
    }

    await tx.insert(stayBookingStatusHistory).values({
      organizationId: orgId,
      bookingId: booking.id,
      fromStatus: booking.status,
      toStatus: booking.status,
      actorUserId: claims.sub,
      reason: 'owner_approved_reschedule',
      metadataJson: pending,
    });
    const updated = await applyStoredPendingRescheduleInTx(tx, booking, 'owner');
    if (!updated) fail('reschedule_not_pending');
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'stay_booking',
      resourceId: booking.id,
      eventType: 'stay.booking.reschedule_approved',
      fromStatus: booking.status,
      toStatus: updated.status,
      metadata: {
        referenceCode: booking.referenceCode,
        fromCheckInOn: booking.checkInOn,
        toCheckInOn: updated.checkInOn,
      },
    });
    return {
      bookingStatus: updated.status,
      applied: true,
      awaitsGuestPayment: false,
    };
  });
}

/** Owner rejects a guest's pending date/period change. */
export async function rejectGuestRescheduleOnNeon(
  claims: SessionClaims,
  propertyId: string,
  bookingId: string,
  note?: string | null,
): Promise<{ bookingStatus: string }> {
  if (!hasPermission(claims, 'stay.booking.manage')) fail('forbidden');
  const { clearPendingRescheduleInTx } = await import('@/lib/public-stays-guest-neon');
  return withinViewerTenant(claims, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${bookingId}, 29))`);
    const { orgId, property } = await loadProperty(tx, claims, propertyId);
    const [booking] = await tx
      .select()
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
    const snapshot =
      booking.pricingSnapshotJson && typeof booking.pricingSnapshotJson === 'object'
        ? (booking.pricingSnapshotJson as Record<string, unknown>)
        : null;
    const pending =
      snapshot?.pendingReschedule && typeof snapshot.pendingReschedule === 'object'
        ? (snapshot.pendingReschedule as Record<string, unknown>)
        : null;
    if (!pending || pending.status !== 'awaiting_owner') fail('reschedule_not_pending');
    const updated = await clearPendingRescheduleInTx(tx, booking, 'owner_rejected_reschedule', {
      note: note?.trim() || null,
      actorUserId: claims.sub,
    });
    return { bookingStatus: updated.status };
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
        approvalMode: sql<string | null>`${contracts.payloadSnapshot}->'approval'->>'mode'`,
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
    if (
      contract.status === 'partially_signed' &&
      contract.approvalMode === 'awaiting_counterparty'
    ) {
      fail('contract_awaiting_counterparty');
    }
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
    const [parties_] = await tx
      .select({ tenantPartyId: contracts.tenantPartyId })
      .from(contracts)
      .where(eq(contracts.id, contract.id))
      .limit(1);
    const kind = contract.type === 'sale' ? 'عقد البيع' : 'عقد الإيجار';
    await notifyInTx(tx, {
      orgId,
      aggregateType: 'contract',
      aggregateId: contract.id,
      audience: { parties: [parties_?.tenantPartyId, contract.ownerPartyId] },
      content: () => ({
        tone: 'contract',
        subject: `🎉 اعتُمد ${kind} ${reference} وأصبح سارياً`,
        title: `${kind} معتمد وساري المفعول`,
        intro: `اعتمد ${viewer.displayName ?? 'المسؤول'} ${kind} ووقّعه، فأصبح سارياً.`,
        details: [
          { label: 'رقم العقد', value: reference },
          { label: 'العقار', value: property.nameAr },
        ],
        cta: {
          label: 'عرض العقد',
          url: appLink(
            contract.type === 'sale' ? '/ar/account' : `/ar/tenant/contracts/${contract.id}`,
          ),
        },
      }),
    });
    return {
      contractId: contract.id,
      contractReference: reference,
      contractStatus: 'signed',
      routedToManager: false,
    };
  });
}

export type ManualLeaseTenantInput = {
  partyId?: string | undefined;
  entityType: 'person' | 'company';
  nameAr: string;
  nameEn?: string | undefined;
  civilId?: string | undefined;
  passport?: string | undefined;
  nationality?: string | undefined;
  crNumber?: string | undefined;
  crExpiry?: string | undefined;
  signatoryName?: string | undefined;
  signatoryCivilId?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
};

export type ManualLeaseInput = {
  unitId: string;
  tenant: ManualLeaseTenantInput;
  terms: LeaseTermsDraft;
};

function tenantDetails(input: ManualLeaseTenantInput) {
  const clean = (value: string | undefined, max: number) => value?.trim().slice(0, max) || null;
  const company = input.entityType === 'company';
  return {
    entityType: input.entityType,
    nameAr: input.nameAr.trim().slice(0, 200),
    nameEn: clean(input.nameEn, 200),
    civilId: company ? null : clean(input.civilId, 40),
    passport: company ? null : clean(input.passport, 40),
    nationality: company ? null : clean(input.nationality, 80),
    crNumber: company ? clean(input.crNumber, 40) : null,
    crExpiry: company ? clean(input.crExpiry, 10) : null,
    signatoryName: company ? clean(input.signatoryName, 200) : null,
    signatoryCivilId: company ? clean(input.signatoryCivilId, 40) : null,
    phone: clean(input.phone, 40),
    email: clean(input.email, 320)?.toLowerCase() ?? null,
  };
}

/**
 * Manual lease with the full terms: rent schedule, VAT, municipality fee, other
 * taxes, grace, deposit lines, extra charges / discounts and cheques. Amounts are
 * recomputed here from the draft; the client preview is never trusted.
 */
export async function createManualLeaseContractOnNeon(
  claims: SessionClaims,
  propertyId: string,
  input: ManualLeaseInput,
): Promise<ContractOutcome> {
  if (!hasPermission(claims, 'contract.create') || !hasPermission(claims, 'lease.create')) {
    fail('forbidden');
  }
  return withinViewerTenant(claims, (tx) =>
    issueManualLeaseInTx(tx, claims, propertyId, input, { source: { type: 'manual' } }),
  );
}

/** Rejects lease terms the server cannot compute, before anything is stored. */
export function assertLeaseTermsValid(terms: LeaseTermsDraft, currency: string) {
  const computed = computeLeaseTerms(terms, currency, minorUnitsFor(currency));
  if (!computed.ok) fail(computed.error);
}

/**
 * The manual lease inside an open viewer transaction. `awaitCounterparty` leaves the
 * contract signed by the owner only, with its lease in draft until the tenant signs.
 */
export async function issueManualLeaseInTx(
  tx: Tx,
  claims: SessionClaims,
  propertyId: string,
  input: ManualLeaseInput,
  options: { source: Record<string, unknown>; awaitCounterparty?: boolean },
): Promise<ContractOutcome & { leaseId: string | null }> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.unitId}::text))`);
  const { orgId, property } = await loadProperty(tx, claims, propertyId);
  const unit = await loadUnit(tx, orgId, property.id, input.unitId);
  const computed = computeLeaseTerms(input.terms, unit.currency, minorUnitsFor(unit.currency));
  if (!computed.ok) fail(computed.error);
  const terms = computed.terms;

  const [overlap] = await tx
    .select({ id: leases.id })
    .from(leases)
    .where(
      and(
        eq(leases.organizationId, orgId),
        eq(leases.unitId, unit.id),
        inArray(leases.status, ['draft', 'active', 'cancel_requested', 'clearance_pending']),
        lte(leases.startsOn, addDays(terms.endsOn, -1)),
        gte(leases.endsOn, addDays(terms.startsOn, 1)),
      ),
    )
    .limit(1);
  if (overlap) fail('lease_overlap');

  const chequeRows = [
    ...terms.schedule.map((row) => ({
      number: row.chequeNumber,
      bank: row.bankName,
      amountMinor: row.totalMinor,
      dueOn: row.dueOn,
    })),
    ...terms.vatCheques.map((row) => ({
      number: row.chequeNumber,
      bank: terms.chequeBankName,
      amountMinor: row.amountMinor,
      dueOn: row.dueOn,
    })),
    ...terms.depositItems
      .filter((item) => item.method === 'cheque')
      .map((item) => ({
        number: item.reference,
        bank: item.bankName ?? terms.chequeBankName,
        amountMinor: item.amountMinor,
        dueOn: item.dueOn ?? terms.startsOn,
      })),
  ].filter((row): row is typeof row & { number: string } => Boolean(row.number));
  if (chequeRows.length) {
    const [taken] = await tx
      .select({ number: cheques.chequeNumber })
      .from(cheques)
      .where(
        and(
          eq(cheques.organizationId, orgId),
          inArray(
            cheques.chequeNumber,
            chequeRows.map((row) => row.number),
          ),
        ),
      )
      .limit(1);
    if (taken) fail('cheque_number_taken');
  }

  const details = tenantDetails(input.tenant);
  let tenant: { id: string; displayName: string };
  if (input.tenant.partyId) {
    const [existing] = await tx
      .select({ id: parties.id, displayName: parties.displayName })
      .from(parties)
      .where(and(eq(parties.id, input.tenant.partyId), eq(parties.organizationId, orgId)))
      .limit(1);
    if (!existing) fail('party_not_found');
    await tx
      .insert(partyRoles)
      .values({ organizationId: orgId, partyId: existing.id, roleKey: 'tenant' })
      .onConflictDoNothing();
    tenant = existing;
  } else {
    tenant = await findOrCreateParty(
      tx,
      orgId,
      {
        displayName: details.nameAr,
        email: details.email,
        phone: details.phone,
        type: details.entityType,
      },
      'tenant',
      'manual_contract',
    );
  }

  const outcome = await issueContract(tx, {
    claims,
    orgId,
    property,
    unit: { id: unit.id, code: unit.code, nameAr: unit.nameAr, nameEn: unit.nameEn },
    counterparty: tenant,
    type: 'lease',
    startsOn: terms.startsOn,
    endsOn: terms.endsOn,
    amountMinor: BigInt(terms.totals.grandTotalMinor),
    leaseRentMinor: BigInt(terms.monthlyRentMinor),
    billingDay: terms.paymentDay,
    depositMinor: terms.totals.depositMinor > 0 ? BigInt(terms.totals.depositMinor) : null,
    currency: unit.currency,
    source: options.source,
    awaitCounterparty: options.awaitCounterparty ?? false,
    extra: {
      tenantDetails: details,
      leaseTerms: terms,
      ...(terms.notes ? { notes: terms.notes } : {}),
    },
  });

  if (outcome.leaseId && chequeRows.length) {
    await tx.insert(cheques).values(
      chequeRows.map((row) => ({
        organizationId: orgId,
        leaseId: outcome.leaseId,
        ownerPartyId: tenant.id,
        bankName: row.bank ?? '—',
        chequeNumber: row.number,
        amountMinor: BigInt(row.amountMinor),
        currency: unit.currency,
        dueOn: row.dueOn,
      })),
    );
  }
  return outcome;
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

/**
 * Sale contract for a website purchase booking: the owner signs now and the buyer signs
 * later. Reuses the booking's sales deal when there is one.
 */
export async function issueReservationSaleInTx(
  tx: Tx,
  claims: SessionClaims,
  propertyId: string,
  input: {
    unitId: string;
    buyerPartyId: string;
    dealId: string | null;
    signedOn: string;
    amount: string;
    notes?: string | undefined;
    source: Record<string, unknown>;
  },
): Promise<ContractOutcome & { leaseId: string | null }> {
  const { orgId, property } = await loadProperty(tx, claims, propertyId);
  const unit = await loadUnit(tx, orgId, property.id, input.unitId);
  const priceMinor = decimalToMinor(input.amount, unit.currency);
  if (priceMinor <= 0n) fail('invalid_amount');
  const buyer = { id: input.buyerPartyId, displayName: await partyName(tx, input.buyerPartyId) };
  const notes = input.notes?.trim().slice(0, 2000) || null;
  let deal: { id: string; reference: string | null } | null = null;
  if (input.dealId) {
    const [updated] = await tx
      .update(salesDeals)
      .set({ status: 'contracting', agreedPriceMinor: priceMinor, updatedAt: new Date() })
      .where(and(eq(salesDeals.id, input.dealId), eq(salesDeals.organizationId, orgId)))
      .returning({ id: salesDeals.id, reference: salesDeals.reference });
    deal = updated ?? null;
  }
  if (!deal) {
    const [created] = await tx
      .insert(salesDeals)
      .values({
        organizationId: orgId,
        reference: `SALE-${input.signedOn.slice(0, 4)}-${randomUUID().slice(0, 8).toUpperCase()}`,
        propertyId: property.id,
        unitId: unit.id,
        sellerPartyId: property.ownerPartyId,
        buyerPartyId: buyer.id,
        assignedToUserId: claims.sub,
        status: 'contracting',
        askingPriceMinor: unit.salePriceMinor ?? priceMinor,
        agreedPriceMinor: priceMinor,
        currency: unit.currency,
        minorUnit: minorUnitsFor(unit.currency),
        notes,
      })
      .returning({ id: salesDeals.id, reference: salesDeals.reference });
    deal = created!;
  }
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
    source: input.source,
    awaitCounterparty: true,
    extra: {
      sale: { dealId: deal.id, dealReference: deal.reference },
      ...(notes ? { notes } : {}),
    },
  });
}

/**
 * The tenant or buyer signs a contract the owner already signed: the contract is complete,
 * its lease starts and a sale deal closes. Runs in the caller's organization-scoped transaction.
 */
export async function completeCounterpartySignatureInTx(
  tx: Tx,
  input: {
    orgId: string;
    contractId: string;
    actorUserId: string;
    signature: CounterpartySignature;
  },
): Promise<{ contractReference: string; leaseId: string | null; alreadySigned: boolean }> {
  const [contract] = await tx
    .select({
      id: contracts.id,
      reference: contracts.reference,
      status: contracts.status,
      tenantPartyId: contracts.tenantPartyId,
      type: sql<string | null>`${contracts.payloadSnapshot}->'contract'->>'type'`,
      saleDealId: sql<string | null>`${contracts.payloadSnapshot}->'sale'->>'dealId'`,
    })
    .from(contracts)
    .where(and(eq(contracts.id, input.contractId), eq(contracts.organizationId, input.orgId)))
    .limit(1);
  if (!contract) fail('contract_not_found');
  const reference = contract.reference ?? contract.id.slice(0, 8).toUpperCase();
  const [lease] = await tx
    .select({ id: leases.id })
    .from(leases)
    .where(and(eq(leases.organizationId, input.orgId), eq(leases.contractId, contract.id)))
    .limit(1);
  if (contract.status === 'signed') {
    return { contractReference: reference, leaseId: lease?.id ?? null, alreadySigned: true };
  }
  if (contract.status !== 'partially_signed') fail('contract_not_pending');
  if (contract.tenantPartyId !== input.signature.partyId) fail('forbidden');

  const signature = input.signature;
  const now = signature.signedAt;
  await tx
    .insert(contractSignatures)
    .values({
      organizationId: input.orgId,
      contractId: contract.id,
      signerPartyId: signature.partyId,
      signerRole: contract.type === 'sale' ? 'buyer' : 'tenant',
      method: signature.method,
      evidence: signature.evidence,
      signatureHash: signatureHash([
        contract.id,
        signature.partyId,
        signature.method,
        now.toISOString(),
      ]),
      signedAt: now,
    })
    .onConflictDoNothing();
  await tx
    .update(contracts)
    .set({ status: 'signed', completedAt: now, updatedAt: now })
    .where(and(eq(contracts.id, contract.id), eq(contracts.organizationId, input.orgId)));
  if (lease) {
    await tx
      .update(leases)
      .set({ status: 'active', updatedAt: now })
      .where(
        and(
          eq(leases.id, lease.id),
          eq(leases.organizationId, input.orgId),
          eq(leases.status, 'draft'),
        ),
      );
  }
  if (contract.type === 'sale' && contract.saleDealId) {
    await tx
      .update(salesDeals)
      .set({ status: 'closed_won', closedOn: omanToday(), updatedAt: now })
      .where(
        and(eq(salesDeals.id, contract.saleDealId), eq(salesDeals.organizationId, input.orgId)),
      );
  }
  await tx.insert(workflowEvents).values({
    organizationId: input.orgId,
    actorUserId: input.actorUserId,
    resourceType: 'contract',
    resourceId: contract.id,
    eventType: 'contract.signed',
    fromStatus: contract.status,
    toStatus: 'signed',
    metadata: { reference, signedBy: contract.type === 'sale' ? 'buyer' : 'tenant' },
  });
  await tx.insert(outboxEvents).values({
    organizationId: input.orgId,
    topic: 'contract.counterparty_signed',
    aggregateType: 'contract',
    aggregateId: contract.id,
    payload: { contractId: contract.id, reference, leaseId: lease?.id ?? null },
  });
  const [owner] = await tx
    .select({ ownerPartyId: contracts.ownerPartyId, propertyId: units.propertyId })
    .from(contracts)
    .innerJoin(units, eq(units.id, contracts.unitId))
    .where(eq(contracts.id, contract.id))
    .limit(1);
  const kind = contract.type === 'sale' ? 'عقد البيع' : 'عقد الإيجار';
  const signer = contract.type === 'sale' ? 'المشتري' : 'المستأجر';
  const details = [
    { label: 'رقم العقد', value: reference },
    { label: 'تاريخ التوقيع', value: arDate(now.toISOString()) },
  ];
  await notifyByEmail({
    orgId: input.orgId,
    aggregateType: 'contract',
    aggregateId: contract.id,
    audience: {
      parties: [owner?.ownerPartyId],
      managersOf: { orgId: input.orgId, propertyId: owner?.propertyId },
    },
    content: () => ({
      tone: 'contract',
      subject: `✍️ وقّع ${signer} ${kind} ${reference} — العقد ساري الآن`,
      title: `اكتملت التواقيع على ${kind} 🎉`,
      intro: `وقّع ${signer} ${kind} إلكترونياً، فاكتمل وأصبح سارياً${lease ? ' وبدأ عقد الإيجار' : ''}.`,
      details,
      cta: { label: 'عرض العقد', url: appLink(`/ar/owner/contracts/${contract.id}`) },
    }),
  });
  await notifyByEmail({
    orgId: input.orgId,
    aggregateType: 'contract',
    aggregateId: contract.id,
    audience: { parties: [contract.tenantPartyId] },
    content: () => ({
      tone: 'contract',
      subject: `🎉 شكراً لتوقيعك — ${kind} ${reference} ساري الآن`,
      title: 'توقيعك وصل، والعقد ساري المفعول',
      intro: `اكتمل ${kind} بتوقيعك، ونسخته محفوظة في حسابك متى احتجتها.`,
      details,
      cta: {
        label: 'عرض العقد',
        url: appLink(
          contract.type === 'sale' ? '/ar/account' : `/ar/tenant/contracts/${contract.id}`,
        ),
      },
    }),
  });
  return { contractReference: reference, leaseId: lease?.id ?? null, alreadySigned: false };
}
