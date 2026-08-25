import { getLocale } from 'next-intl/server';
import { ApiError } from '@/lib/api';
import {
  apiFetch,
  isNestApiConfiguredForRuntime,
  probeNestReady,
} from '@/lib/server-api';
import type { PortalRole } from '@/lib/types';
import { OperationsConsole, type OperationsContext } from './operations-console';

export type OperationsSection =
  | 'properties'
  | 'contacts'
  | 'requests'
  | 'bookings'
  | 'leasing'
  | 'sales'
  | 'contracts'
  | 'invoices'
  | 'payments'
  | 'accounting'
  | 'expenses'
  | 'maintenance'
  | 'work-orders'
  | 'tasks'
  | 'legal'
  | 'approvals'
  | 'reports'
  | 'team'
  | 'api-keys';

type DataRow = Record<string, unknown>;

async function safeRows(path: string): Promise<DataRow[]> {
  const payload = await apiFetch<DataRow[] | { data: DataRow[] }>(path).catch(() => []);
  return Array.isArray(payload) ? payload : payload.data;
}

async function loadSection(portal: PortalRole, section: OperationsSection) {
  switch (section) {
    case 'properties':
      return {
        records: await safeRows(
          portal === 'developer' ? '/v1/developer/projects' : '/v1/owner/properties',
        ),
      };
    case 'contacts':
      return { records: await safeRows('/v1/parties') };
    case 'requests':
      return { records: await safeRows('/v1/operations/requests') };
    case 'bookings': {
      const [reservations, viewings, holds] = await Promise.all([
        safeRows('/v1/leasing/reservations'),
        safeRows('/v1/operations/viewings'),
        safeRows('/v1/leasing/holds'),
      ]);
      return {
        records: [
          ...reservations.map((row) => ({ ...row, recordKind: 'reservation' })),
          ...viewings.map((row) => ({ ...row, recordKind: 'viewing' })),
          ...holds.map((row) => ({ ...row, recordKind: 'hold' })),
        ],
      };
    }
    case 'leasing':
      return { records: await safeRows('/v1/leasing/leases') };
    case 'sales': {
      const [records, totals] = await Promise.all([
        safeRows('/v1/operations/sales'),
        apiFetch<Record<string, unknown>>('/v1/operations/sales/totals').catch(() => ({})),
      ]);
      return { records, summary: totals };
    }
    case 'contracts':
      return { records: await safeRows('/v1/leasing/contracts') };
    case 'invoices':
      return { records: await safeRows('/v1/finance/invoices') };
    case 'payments': {
      const [payments, receipts] = await Promise.all([
        safeRows('/v1/finance/payments'),
        safeRows('/v1/finance/receipts'),
      ]);
      return {
        records: [
          ...payments.map((row) => ({ ...row, recordKind: 'payment' })),
          ...receipts.map((row) => ({ ...row, recordKind: 'receipt', status: 'issued' })),
        ],
      };
    }
    case 'accounting': {
      const [records, dashboard, trialBalance, chequeRows, invoiceRows] = await Promise.all([
        safeRows('/v1/accounting/journals'),
        apiFetch<Record<string, unknown>>('/v1/accounting/dashboard').catch(() => ({})),
        safeRows('/v1/accounting/trial-balance'),
        safeRows('/v1/finance/cheques'),
        safeRows('/v1/finance/invoices'),
      ]);
      return {
        records,
        summary: {
          ...dashboard,
          activeLeaseInvoices: invoiceRows.filter((row) => row.leaseId && row.status !== 'void')
            .length,
          pendingCheques: chequeRows.filter((row) => row.reviewStatus === 'pending').length,
        },
        secondary: [
          ...chequeRows.map((row) => ({ ...row, recordKind: 'cheque', status: row.reviewStatus })),
          ...invoiceRows
            .filter((row) => row.leaseId)
            .map((row) => ({ ...row, recordKind: 'lease_invoice' })),
        ],
      };
    }
    case 'expenses':
      return { records: await safeRows('/v1/accounting/expenses') };
    case 'maintenance':
      return { records: await safeRows('/v1/maintenance') };
    case 'work-orders':
      return { records: await safeRows('/v1/operations/work-orders') };
    case 'tasks':
      return { records: await safeRows('/v1/operations/tasks') };
    case 'legal':
      return { records: await safeRows('/v1/operations/legal-cases') };
    case 'approvals':
      return { records: await safeRows('/v1/operations/approvals') };
    case 'reports': {
      const [records, summary] = await Promise.all([
        safeRows('/v1/reports'),
        apiFetch<Record<string, unknown>>('/v1/reports/operational-summary').catch(() => ({})),
      ]);
      return { records, summary };
    }
    case 'team':
      return { records: await safeRows('/v1/organizations/current/members') };
    case 'api-keys':
      return { records: await safeRows('/v1/auth/api-keys') };
  }
}

export async function OperationsWorkspace({
  portal,
  section,
}: {
  portal: PortalRole;
  section: OperationsSection;
}) {
  const locale = (await getLocale()) === 'en' ? 'en' : 'ar';
  const nestConfigured = isNestApiConfiguredForRuntime();
  const [loaded, nestReady, contextResult] = await Promise.all([
    loadSection(portal, section),
    portal === 'tenant' ? Promise.resolve(true) : probeNestReady(),
    portal === 'tenant'
      ? Promise.resolve({
          ok: true as const,
          unauthorized: false,
          context: {} as OperationsContext,
        })
      : apiFetch<OperationsContext>('/v1/operations/context')
          .then((payload) => ({
            ok: true as const,
            unauthorized: false,
            context: payload,
          }))
          .catch((error: unknown) => ({
            ok: false as const,
            unauthorized: error instanceof ApiError && error.status === 401,
            context: {} as OperationsContext,
          })),
  ]);
  // Infrastructure up ≠ authorized. Only treat Nest as offline when health fails.
  const apiOnline = portal === 'tenant' ? true : nestReady;
  const context = contextResult.context;
  const recordsEmpty = !loaded.records.length;
  return (
    <OperationsConsole
      portal={portal}
      section={section}
      locale={locale}
      records={loaded.records}
      summary={loaded.summary ?? {}}
      secondary={loaded.secondary ?? []}
      context={context}
      apiOnline={apiOnline}
      nestConfigured={nestConfigured}
      recordsEmpty={recordsEmpty}
      apiUnauthorized={Boolean(contextResult.unauthorized)}
    />
  );
}
