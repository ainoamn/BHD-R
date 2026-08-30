import { getLocale } from 'next-intl/server';
import { ApiError } from '@/lib/api';
import {
  apiFetch,
  configuredApiOrigin,
  isNestApiConfiguredForRuntime,
} from '@/lib/server-api';
import { loadOpsRecordsFromDb } from '@/lib/portal-ops-data';
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
  const payload = await Promise.race([
    apiFetch<DataRow[] | { data: DataRow[] }>(path)
      .then((value) => value)
      .catch(() => [] as DataRow[] | { data: DataRow[] }),
    new Promise<DataRow[]>((resolve) => {
      setTimeout(() => resolve([]), 3_500);
    }),
  ]);
  return Array.isArray(payload) ? payload : (payload.data ?? []);
}

async function loadSection(portal: PortalRole, section: OperationsSection) {
  const fromDb = await loadOpsRecordsFromDb(portal, section);
  if (fromDb !== null) return { records: fromDb as DataRow[], source: 'db' as const };

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

async function probeNestHealthz(): Promise<boolean> {
  const origin = configuredApiOrigin();
  if (!origin) return false;
  try {
    const response = await fetch(`${origin}/healthz`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok;
  } catch {
    return false;
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
  // Platform health (/healthz) is raw Node and reliable on Render.
  // Nest /v1 may still hang; don't treat that alone as "Nest down" for the banner.
  const [loaded, contextResult, healthzOk] = await Promise.all([
    loadSection(portal, section),
    portal === 'tenant'
      ? Promise.resolve({
          ok: true as const,
          unauthorized: false,
          unreachable: false,
          context: {} as OperationsContext,
        })
      : Promise.race([
          apiFetch<OperationsContext>('/v1/operations/context')
            .then((payload) => ({
              ok: true as const,
              unauthorized: false,
              unreachable: false,
              context: payload,
            }))
            .catch((error: unknown) => ({
              ok: false as const,
              unauthorized: error instanceof ApiError && error.status === 401,
              unreachable:
                error instanceof ApiError &&
                (error.status === 503 || error.code === 'api_unreachable'),
              context: {} as OperationsContext,
            })),
          new Promise<{
            ok: false;
            unauthorized: false;
            unreachable: true;
            context: OperationsContext;
          }>((resolve) => {
            setTimeout(
              () =>
                resolve({
                  ok: false,
                  unauthorized: false,
                  unreachable: true,
                  context: {} as OperationsContext,
                }),
              3_500,
            );
          }),
        ]),
    probeNestHealthz(),
  ]);
  const apiOnline = portal === 'tenant' ? true : healthzOk || !contextResult.unreachable;
  const context = contextResult.context;
  const recordsEmpty = !loaded.records.length;
  const dataFromDb = 'source' in loaded && loaded.source === 'db';
  // When Neon already serves the list, Nest 401 must not alarm owners on mobile.
  const apiUnauthorized =
    Boolean(contextResult.unauthorized) && !(dataFromDb && !recordsEmpty);
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
      apiUnauthorized={apiUnauthorized}
      dataFromDb={dataFromDb}
    />
  );
}
