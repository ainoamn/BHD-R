import 'server-only';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  contracts,
  createDatabase,
  invoices,
  leases,
  payments,
  stayBookings,
  stayBookingGuests,
  stayPaymentIntents,
  units,
  type Database,
} from '@bhd-r/db';

export type PropertyOpsStayBooking = {
  id: string;
  referenceCode: string;
  unitCode: string;
  status: string;
  checkInOn: string;
  checkOutOn: string;
  currency: string;
  totalMinor: string;
  guestName: string | null;
};

export type PropertyOpsContract = {
  id: string;
  reference: string | null;
  status: string;
  unitCode: string;
  kind: string;
};

export type PropertyOpsLease = {
  id: string;
  status: string;
  unitCode: string;
  startsOn: string;
  endsOn: string;
  currency: string;
  rentMinor: string;
  contractId: string | null;
};

export type PropertyOpsInvoice = {
  id: string;
  invoiceNumber: string;
  status: string;
  currency: string;
  totalMinor: string;
  paidMinor: string;
  dueOn: string;
};

export type PropertyOpsStayPayment = {
  id: string;
  bookingId: string;
  referenceCode: string;
  status: string;
  currency: string;
  amountMinor: string;
  provider: string | null;
  createdAt: string;
};

export type PropertyOpsPulse = {
  stayBookings: PropertyOpsStayBooking[];
  contracts: PropertyOpsContract[];
  leases: PropertyOpsLease[];
  invoices: PropertyOpsInvoice[];
  stayPayments: PropertyOpsStayPayment[];
  finance: {
    stayCollectedMinorByCurrency: Array<{ currency: string; amountMinor: string }>;
    leaseInvoiceOpenMinorByCurrency: Array<{ currency: string; amountMinor: string }>;
    leaseCollectedMinorByCurrency: Array<{ currency: string; amountMinor: string }>;
  };
};

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRPropertyOpsPulseDb?: DbHandle };

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRPropertyOpsPulseDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdRPropertyOpsPulseDb = { db };
  }
  return globalForDb.__bhdRPropertyOpsPulseDb;
}

function isoDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function aggregateMinor(
  rows: Array<{ currency: string; amount: bigint }>,
): Array<{ currency: string; amountMinor: string }> {
  const map = new Map<string, bigint>();
  for (const row of rows) {
    map.set(row.currency, (map.get(row.currency) ?? 0n) + row.amount);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => ({ currency, amountMinor: amount.toString() }));
}

/**
 * Live ops snapshot for one property: stay bookings, lease contracts,
 * invoices/payments, and stay payment intents (for finance reflection).
 */
export async function loadPropertyOpsPulseOnNeon(
  organizationId: string,
  propertyId: string,
  options?: { userId?: string | null; partyId?: string | null },
): Promise<PropertyOpsPulse> {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select set_config('app.organization_id', ${organizationId}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.user_id', ${options?.userId ?? ''}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.party_id', ${options?.partyId ?? ''}, true)`,
    );
    await transaction.execute(sql`select set_config('app.platform_admin', 'false', true)`);
    await transaction.execute(sql`select set_config('app.public', 'false', true)`);

    const unitRows = await transaction
      .select({ id: units.id, code: units.code })
      .from(units)
      .where(and(eq(units.organizationId, organizationId), eq(units.propertyId, propertyId)));
    const unitIds = unitRows.map((row) => row.id);
    const unitCodeById = new Map(unitRows.map((row) => [row.id, row.code]));

    const stayRows = await transaction
      .select({
        id: stayBookings.id,
        referenceCode: stayBookings.referenceCode,
        unitId: stayBookings.unitId,
        status: stayBookings.status,
        checkInOn: stayBookings.checkInOn,
        checkOutOn: stayBookings.checkOutOn,
        currency: stayBookings.currency,
        totalMinor: stayBookings.totalMinor,
      })
      .from(stayBookings)
      .where(
        and(
          eq(stayBookings.organizationId, organizationId),
          eq(stayBookings.propertyId, propertyId),
        ),
      )
      .orderBy(desc(stayBookings.createdAt))
      .limit(40);

    const stayIds = stayRows.map((row) => row.id);
    const guestByBooking = new Map<string, string>();
    if (stayIds.length) {
      const guests = await transaction
        .select({
          bookingId: stayBookingGuests.bookingId,
          displayName: stayBookingGuests.displayName,
        })
        .from(stayBookingGuests)
        .where(
          and(
            eq(stayBookingGuests.organizationId, organizationId),
            eq(stayBookingGuests.isPrimary, true),
            inArray(stayBookingGuests.bookingId, stayIds),
          ),
        );
      for (const guest of guests) {
        if (guest.displayName) guestByBooking.set(guest.bookingId, guest.displayName);
      }
    }

    const stayBookingItems: PropertyOpsStayBooking[] = stayRows.map((row) => ({
      id: row.id,
      referenceCode: row.referenceCode,
      unitCode: unitCodeById.get(row.unitId) ?? '—',
      status: row.status,
      checkInOn: isoDate(row.checkInOn),
      checkOutOn: isoDate(row.checkOutOn),
      currency: row.currency,
      totalMinor: row.totalMinor.toString(),
      guestName: guestByBooking.get(row.id) ?? null,
    }));

    let contractItems: PropertyOpsContract[] = [];
    let leaseItems: PropertyOpsLease[] = [];
    let invoiceItems: PropertyOpsInvoice[] = [];
    let leaseOpen: Array<{ currency: string; amount: bigint }> = [];
    let leaseCollected: Array<{ currency: string; amount: bigint }> = [];

    if (unitIds.length) {
      const contractRows = await transaction
        .select({
          id: contracts.id,
          reference: contracts.reference,
          status: contracts.status,
          unitId: contracts.unitId,
          kind: contracts.kind,
        })
        .from(contracts)
        .where(
          and(eq(contracts.organizationId, organizationId), inArray(contracts.unitId, unitIds)),
        )
        .orderBy(desc(contracts.createdAt))
        .limit(40);
      contractItems = contractRows.map((row) => ({
        id: row.id,
        reference: row.reference,
        status: row.status,
        unitCode: unitCodeById.get(row.unitId) ?? '—',
        kind: row.kind,
      }));

      const leaseRows = await transaction
        .select({
          id: leases.id,
          status: leases.status,
          unitId: leases.unitId,
          startsOn: leases.startsOn,
          endsOn: leases.endsOn,
          currency: leases.currency,
          rentMinor: leases.rentMinor,
          contractId: leases.contractId,
        })
        .from(leases)
        .where(and(eq(leases.organizationId, organizationId), inArray(leases.unitId, unitIds)))
        .orderBy(desc(leases.createdAt))
        .limit(40);
      leaseItems = leaseRows.map((row) => ({
        id: row.id,
        status: row.status,
        unitCode: unitCodeById.get(row.unitId) ?? '—',
        startsOn: isoDate(row.startsOn),
        endsOn: isoDate(row.endsOn),
        currency: row.currency,
        rentMinor: row.rentMinor.toString(),
        contractId: row.contractId,
      }));

      const leaseIds = leaseRows.map((row) => row.id);
      if (leaseIds.length) {
        const invoiceRows = await transaction
          .select({
            id: invoices.id,
            invoiceNumber: invoices.invoiceNumber,
            status: invoices.status,
            currency: invoices.currency,
            totalMinor: invoices.totalMinor,
            paidMinor: invoices.paidMinor,
            dueOn: invoices.dueOn,
          })
          .from(invoices)
          .where(
            and(eq(invoices.organizationId, organizationId), inArray(invoices.leaseId, leaseIds)),
          )
          .orderBy(desc(invoices.createdAt))
          .limit(40);
        invoiceItems = invoiceRows.map((row) => ({
          id: row.id,
          invoiceNumber: row.invoiceNumber,
          status: row.status,
          currency: row.currency,
          totalMinor: row.totalMinor.toString(),
          paidMinor: row.paidMinor.toString(),
          dueOn: isoDate(row.dueOn),
        }));
        leaseOpen = invoiceRows
          .filter((row) => row.status !== 'void' && row.status !== 'paid')
          .map((row) => ({
            currency: row.currency,
            amount: row.totalMinor - row.paidMinor,
          }))
          .filter((row) => row.amount > 0n);

        const paymentRows = await transaction
          .select({
            currency: payments.currency,
            amountMinor: payments.amountMinor,
            status: payments.status,
          })
          .from(payments)
          .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
          .where(
            and(
              eq(payments.organizationId, organizationId),
              inArray(invoices.leaseId, leaseIds),
              eq(payments.status, 'succeeded'),
            ),
          );
        leaseCollected = paymentRows.map((row) => ({
          currency: row.currency,
          amount: row.amountMinor,
        }));
      }
    }

    const stayPaymentRows = stayIds.length
      ? await transaction
          .select({
            id: stayPaymentIntents.id,
            bookingId: stayPaymentIntents.bookingId,
            status: stayPaymentIntents.status,
            currency: stayPaymentIntents.currency,
            amountMinor: stayPaymentIntents.amountMinor,
            provider: stayPaymentIntents.provider,
            createdAt: stayPaymentIntents.createdAt,
          })
          .from(stayPaymentIntents)
          .where(
            and(
              eq(stayPaymentIntents.organizationId, organizationId),
              inArray(stayPaymentIntents.bookingId, stayIds),
            ),
          )
          .orderBy(desc(stayPaymentIntents.createdAt))
          .limit(40)
      : [];

    const stayRefById = new Map(stayRows.map((row) => [row.id, row.referenceCode]));
    const stayPaymentItems: PropertyOpsStayPayment[] = stayPaymentRows.map((row) => ({
      id: row.id,
      bookingId: row.bookingId,
      referenceCode: stayRefById.get(row.bookingId) ?? '—',
      status: row.status,
      currency: row.currency,
      amountMinor: row.amountMinor.toString(),
      provider: row.provider,
      createdAt:
        row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    }));

    const stayCollected = stayPaymentRows
      .filter((row) => row.status === 'succeeded')
      .map((row) => ({ currency: row.currency, amount: row.amountMinor }));

    // Fallback: confirmed stay bookings totals when payment intent status naming differs.
    if (!stayCollected.length) {
      for (const booking of stayRows) {
        if (
          booking.status === 'confirmed' ||
          booking.status === 'pre_arrival' ||
          booking.status === 'checked_in' ||
          booking.status === 'checked_out' ||
          booking.status === 'closed'
        ) {
          stayCollected.push({ currency: booking.currency, amount: booking.totalMinor });
        }
      }
    }

    return {
      stayBookings: stayBookingItems,
      contracts: contractItems,
      leases: leaseItems,
      invoices: invoiceItems,
      stayPayments: stayPaymentItems,
      finance: {
        stayCollectedMinorByCurrency: aggregateMinor(stayCollected),
        leaseInvoiceOpenMinorByCurrency: aggregateMinor(leaseOpen),
        leaseCollectedMinorByCurrency: aggregateMinor(leaseCollected),
      },
    };
  });
}

export const emptyPropertyOpsPulse = (): PropertyOpsPulse => ({
  stayBookings: [],
  contracts: [],
  leases: [],
  invoices: [],
  stayPayments: [],
  finance: {
    stayCollectedMinorByCurrency: [],
    leaseInvoiceOpenMinorByCurrency: [],
    leaseCollectedMinorByCurrency: [],
  },
});
