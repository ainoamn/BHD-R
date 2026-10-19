import 'server-only';
import { sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import { elevatedTx, isMissingTable, rowsOf } from '@/lib/elevated-db';
import {
  LAB_RESET_CATEGORIES,
  LAB_RESET_CONFIRM,
  type LabResetCategory,
  type LabResetCounts,
  type LabResetResult,
} from '@/lib/lab-reset-shared';

function deny(): never {
  throw new Error('forbidden');
}

function bad(): never {
  throw new Error('invalid_body');
}

function requireOwnerReset(claims: SessionClaims): string {
  if (!claims.organizationId || !hasPermission(claims, 'organization.write')) deny();
  return claims.organizationId;
}

async function countTable(
  tx: Parameters<Parameters<typeof elevatedTx>[0]>[0],
  orgId: string,
  table: string,
  extra = sql``,
): Promise<number> {
  try {
    const rows = rowsOf<{ n: number }>(
      await tx.execute(
        sql`select count(*)::int as n from ${sql.identifier(table)}
            where organization_id = ${orgId}::uuid ${extra}`,
      ),
    );
    return rows[0]?.n ?? 0;
  } catch (error) {
    if (isMissingTable(error)) return 0;
    throw error;
  }
}

async function deleteTable(
  tx: Parameters<Parameters<typeof elevatedTx>[0]>[0],
  orgId: string,
  table: string,
  extra = sql``,
): Promise<number> {
  try {
    const before = await countTable(tx, orgId, table, extra);
    if (!before) return 0;
    await tx.execute(
      sql`delete from ${sql.identifier(table)}
          where organization_id = ${orgId}::uuid ${extra}`,
    );
    return before;
  } catch (error) {
    if (isMissingTable(error)) return 0;
    throw error;
  }
}

async function sumDeletes(
  tx: Parameters<Parameters<typeof elevatedTx>[0]>[0],
  orgId: string,
  tables: string[],
): Promise<number> {
  let total = 0;
  for (const table of tables) {
    total += await deleteTable(tx, orgId, table);
  }
  return total;
}

/** Row counts per wipe category (properties/units never counted). */
export async function labResetCounts(claims: SessionClaims): Promise<LabResetCounts> {
  const orgId = requireOwnerReset(claims);
  return elevatedTx(async (tx) => {
    const [
      tasks,
      accounting,
      leasing,
      bookings,
      stays,
      maintenance,
      legal,
      sales,
      approvals,
    ] = await Promise.all([
      countTable(tx, orgId, 'work_tasks'),
      (async () =>
        (await countTable(tx, orgId, 'journal_entries')) +
        (await countTable(tx, orgId, 'expenses')) +
        (await countTable(tx, orgId, 'cheques')))(),
      (async () =>
        (await countTable(tx, orgId, 'leases')) +
        (await countTable(tx, orgId, 'invoices')) +
        (await countTable(tx, orgId, 'payments')) +
        (await countTable(tx, orgId, 'receipts')))(),
      (async () =>
        (await countTable(tx, orgId, 'reservations')) +
        (await countTable(tx, orgId, 'contracts')) +
        (await countTable(tx, orgId, 'holds')))(),
      countTable(tx, orgId, 'stay_bookings'),
      (async () =>
        (await countTable(tx, orgId, 'maintenance_tickets')) +
        (await countTable(tx, orgId, 'maintenance_work_orders')) +
        (await countTable(tx, orgId, 'operational_requests')))(),
      countTable(tx, orgId, 'legal_cases'),
      countTable(tx, orgId, 'sales_deals'),
      countTable(tx, orgId, 'approval_requests'),
    ]);
    return {
      tasks,
      accounting,
      leasing,
      bookings,
      stays,
      maintenance,
      legal,
      sales,
      approvals,
    };
  }, 20_000);
}

async function wipeTasks(
  tx: Parameters<Parameters<typeof elevatedTx>[0]>[0],
  orgId: string,
): Promise<number> {
  const events = await deleteTable(
    tx,
    orgId,
    'workflow_events',
    sql`and resource_type = 'work_task'`,
  );
  const tasks = await deleteTable(tx, orgId, 'work_tasks');
  return events + tasks;
}

async function wipeAccounting(
  tx: Parameters<Parameters<typeof elevatedTx>[0]>[0],
  orgId: string,
): Promise<number> {
  try {
    await tx.execute(
      sql`update journal_entries set reversal_of_id = null
          where organization_id = ${orgId}::uuid`,
    );
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
  const lines = await deleteTable(tx, orgId, 'journal_lines');
  const entries = await deleteTable(tx, orgId, 'journal_entries');
  const expenses = await deleteTable(tx, orgId, 'expenses');
  const cheques = await deleteTable(tx, orgId, 'cheques');
  try {
    await tx.execute(
      sql`update journal_sequences set next_value = 1
          where organization_id = ${orgId}::uuid`,
    );
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
  return lines + entries + expenses + cheques;
}

async function wipeLeasing(
  tx: Parameters<Parameters<typeof elevatedTx>[0]>[0],
  orgId: string,
): Promise<number> {
  try {
    await tx.execute(
      sql`update legal_cases set lease_id = null where organization_id = ${orgId}::uuid`,
    );
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
  try {
    await tx.execute(
      sql`update leases set renewal_pending_contract_id = null, contract_id = null
          where organization_id = ${orgId}::uuid`,
    );
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
  const n =
    (await deleteTable(tx, orgId, 'receipts')) +
    (await deleteTable(tx, orgId, 'refunds')) +
    (await deleteTable(tx, orgId, 'payments')) +
    (await deleteTable(tx, orgId, 'payment_sessions')) +
    (await deleteTable(tx, orgId, 'invoice_lines')) +
    (await deleteTable(tx, orgId, 'invoices')) +
    (await deleteTable(tx, orgId, 'billing_schedules')) +
    (await deleteTable(tx, orgId, 'leases'));
  try {
    await tx.execute(
      sql`update invoice_sequences set next_value = 1 where organization_id = ${orgId}::uuid`,
    );
    await tx.execute(
      sql`update receipt_sequences set next_value = 1 where organization_id = ${orgId}::uuid`,
    );
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
  return n;
}

async function wipeBookings(
  tx: Parameters<Parameters<typeof elevatedTx>[0]>[0],
  orgId: string,
): Promise<number> {
  try {
    await tx.execute(
      sql`update leases set contract_id = null, renewal_pending_contract_id = null
          where organization_id = ${orgId}::uuid`,
    );
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
  const n =
    (await deleteTable(tx, orgId, 'signature_challenges')) +
    (await deleteTable(tx, orgId, 'contract_signatures')) +
    (await deleteTable(tx, orgId, 'reservation_documents')) +
    (await deleteTable(tx, orgId, 'reservation_requirements')) +
    (await deleteTable(tx, orgId, 'contracts')) +
    (await deleteTable(tx, orgId, 'reservations')) +
    (await deleteTable(tx, orgId, 'holds')) +
    (await deleteTable(tx, orgId, 'viewing_requests'));
  try {
    await tx.execute(
      sql`update contract_sequences set next_value = 1 where organization_id = ${orgId}::uuid`,
    );
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
  return n;
}

async function wipeStays(
  tx: Parameters<Parameters<typeof elevatedTx>[0]>[0],
  orgId: string,
): Promise<number> {
  return sumDeletes(tx, orgId, [
    'booking_review_photos',
    'booking_reviews',
    'stay_reviews',
    'stay_deposit_claims',
    'stay_refunds',
    'stay_payment_allocations',
    'stay_charges',
    'stay_folios',
    'stay_payment_intents',
    'stay_booking_status_history',
    'stay_booking_guests',
    'stay_housekeeping_tasks',
    'stay_bookings',
    'stay_holds',
    'stay_quotes',
    'stay_inventory_locks',
  ]);
}

async function wipeMaintenance(
  tx: Parameters<Parameters<typeof elevatedTx>[0]>[0],
  orgId: string,
): Promise<number> {
  try {
    await tx.execute(
      sql`update expenses set work_order_id = null where organization_id = ${orgId}::uuid`,
    );
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
  return (
    (await deleteTable(tx, orgId, 'maintenance_work_orders')) +
    (await deleteTable(tx, orgId, 'maintenance_tickets')) +
    (await deleteTable(tx, orgId, 'operational_requests'))
  );
}

async function wipeLegal(
  tx: Parameters<Parameters<typeof elevatedTx>[0]>[0],
  orgId: string,
): Promise<number> {
  const events = await deleteTable(
    tx,
    orgId,
    'workflow_events',
    sql`and resource_type = 'legal_case'`,
  );
  return events + (await deleteTable(tx, orgId, 'legal_cases'));
}

async function wipeSales(
  tx: Parameters<Parameters<typeof elevatedTx>[0]>[0],
  orgId: string,
): Promise<number> {
  return deleteTable(tx, orgId, 'sales_deals');
}

async function wipeApprovals(
  tx: Parameters<Parameters<typeof elevatedTx>[0]>[0],
  orgId: string,
): Promise<number> {
  return deleteTable(tx, orgId, 'approval_requests');
}

/** Permanently delete selected transactional data for this organization. */
export async function labResetPurge(
  claims: SessionClaims,
  input: { categories: LabResetCategory[]; confirm: string },
): Promise<LabResetResult> {
  const orgId = requireOwnerReset(claims);
  if (input.confirm.trim().toUpperCase() !== LAB_RESET_CONFIRM) bad();
  const selected = [...new Set(input.categories)].filter((item): item is LabResetCategory =>
    (LAB_RESET_CATEGORIES as readonly string[]).includes(item),
  );
  if (!selected.length) bad();

  // Bookings before leasing when both selected (contracts referenced by leases).
  const order: LabResetCategory[] = [
    'tasks',
    'approvals',
    'legal',
    'sales',
    'maintenance',
    'stays',
    'bookings',
    'leasing',
    'accounting',
  ];
  const sorted = order.filter((item) => selected.includes(item));

  return elevatedTx(async (tx) => {
    const deleted: Partial<Record<LabResetCategory, number>> = {};
    for (const category of sorted) {
      switch (category) {
        case 'tasks':
          deleted.tasks = await wipeTasks(tx, orgId);
          break;
        case 'accounting':
          deleted.accounting = await wipeAccounting(tx, orgId);
          break;
        case 'leasing':
          deleted.leasing = await wipeLeasing(tx, orgId);
          break;
        case 'bookings':
          deleted.bookings = await wipeBookings(tx, orgId);
          break;
        case 'stays':
          deleted.stays = await wipeStays(tx, orgId);
          break;
        case 'maintenance':
          deleted.maintenance = await wipeMaintenance(tx, orgId);
          break;
        case 'legal':
          deleted.legal = await wipeLegal(tx, orgId);
          break;
        case 'sales':
          deleted.sales = await wipeSales(tx, orgId);
          break;
        case 'approvals':
          deleted.approvals = await wipeApprovals(tx, orgId);
          break;
        default:
          break;
      }
    }
    return { deleted };
  }, 120_000);
}
