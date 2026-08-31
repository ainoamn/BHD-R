import 'server-only';
import { getLocale } from 'next-intl/server';
import { ApiError } from '@/lib/api';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { apiFetch, configuredApiOrigin, isNestApiConfiguredForRuntime } from '@/lib/server-api';
import { loadOpsRecordsFromDb } from '@/lib/portal-ops-data';
import type { PortalRole } from '@/lib/types';
import type { OperationsContext } from '@/components/operations-console';
import type { OperationsSection, OperationsWorkspacePayload } from '@/lib/portal-ops-types';
import { opsSectionsForPortal } from '@/lib/portal-ops-types';

export type { OperationsSection, OperationsWorkspacePayload } from '@/lib/portal-ops-types';
export { isOperationsSection, OPERATIONS_SECTIONS } from '@/lib/portal-ops-types';

type DataRow = Record<string, unknown>;
type SectionLoad = {
  records: DataRow[];
  source: 'db' | 'offline' | 'nest';
  summary?: Record<string, unknown>;
  secondary?: DataRow[];
};

const NEST_PROBE_MS = 1_500;
const NEST_ROW_RACE_MS = 2_500;
const NEST_CONTEXT_RACE_MS = 2_000;
const NEST_HEALTH_TTL_MS = 10_000;

let nestHealthCache: { at: number; ok: boolean } | null = null;

async function safeRows(path: string): Promise<DataRow[]> {
  const payload = await Promise.race([
    apiFetch<DataRow[] | { data: DataRow[] }>(path)
      .then((value) => value)
      .catch(() => [] as DataRow[] | { data: DataRow[] }),
    new Promise<DataRow[]>((resolve) => {
      setTimeout(() => resolve([]), NEST_ROW_RACE_MS);
    }),
  ]);
  return Array.isArray(payload) ? payload : (payload.data ?? []);
}

async function probeNestHealthz(): Promise<boolean> {
  if (nestHealthCache && Date.now() - nestHealthCache.at < NEST_HEALTH_TTL_MS) {
    return nestHealthCache.ok;
  }
  const origin = configuredApiOrigin();
  if (!origin) {
    nestHealthCache = { at: Date.now(), ok: false };
    return false;
  }
  try {
    const response = await fetch(`${origin}/healthz`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(NEST_PROBE_MS),
    });
    const ok = response.ok;
    nestHealthCache = { at: Date.now(), ok };
    return ok;
  } catch {
    nestHealthCache = { at: Date.now(), ok: false };
    return false;
  }
}

async function loadFromNest(portal: PortalRole, section: OperationsSection): Promise<SectionLoad> {
  switch (section) {
    case 'properties':
      return {
        source: 'nest',
        records: await safeRows(
          portal === 'developer' ? '/v1/developer/projects' : '/v1/owner/properties',
        ),
      };
    case 'contacts':
      return { source: 'nest', records: await safeRows('/v1/parties') };
    case 'requests':
      return { source: 'nest', records: await safeRows('/v1/operations/requests') };
    case 'bookings': {
      const [reservations, viewings, holds] = await Promise.all([
        safeRows('/v1/leasing/reservations'),
        safeRows('/v1/operations/viewings'),
        safeRows('/v1/leasing/holds'),
      ]);
      return {
        source: 'nest',
        records: [
          ...reservations.map((row) => ({ ...row, recordKind: 'reservation' })),
          ...viewings.map((row) => ({ ...row, recordKind: 'viewing' })),
          ...holds.map((row) => ({ ...row, recordKind: 'hold' })),
        ],
      };
    }
    case 'leasing':
      return { source: 'nest', records: await safeRows('/v1/leasing/leases') };
    case 'sales': {
      const [records, totals] = await Promise.all([
        safeRows('/v1/operations/sales'),
        apiFetch<Record<string, unknown>>('/v1/operations/sales/totals').catch(() => ({})),
      ]);
      return { source: 'nest', records, summary: totals };
    }
    case 'contracts':
      return { source: 'nest', records: await safeRows('/v1/leasing/contracts') };
    case 'invoices':
      return { source: 'nest', records: await safeRows('/v1/finance/invoices') };
    case 'payments': {
      const [payments, receipts] = await Promise.all([
        safeRows('/v1/finance/payments'),
        safeRows('/v1/finance/receipts'),
      ]);
      return {
        source: 'nest',
        records: [
          ...payments.map((row) => ({ ...row, recordKind: 'payment' })),
          ...receipts.map((row) => ({ ...row, recordKind: 'receipt', status: 'issued' })),
        ],
      };
    }
    case 'accounting': {
      const [records, dashboard, chequeRows, invoiceRows] = await Promise.all([
        safeRows('/v1/accounting/journals'),
        apiFetch<Record<string, unknown>>('/v1/accounting/dashboard').catch(() => ({})),
        safeRows('/v1/finance/cheques'),
        safeRows('/v1/finance/invoices'),
      ]);
      return {
        source: 'nest',
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
      return { source: 'nest', records: await safeRows('/v1/accounting/expenses') };
    case 'maintenance':
      return { source: 'nest', records: await safeRows('/v1/maintenance') };
    case 'work-orders':
      return { source: 'nest', records: await safeRows('/v1/operations/work-orders') };
    case 'tasks':
      return { source: 'nest', records: await safeRows('/v1/operations/tasks') };
    case 'legal':
      return { source: 'nest', records: await safeRows('/v1/operations/legal-cases') };
    case 'approvals':
      return { source: 'nest', records: await safeRows('/v1/operations/approvals') };
    case 'reports': {
      const [records, summary] = await Promise.all([
        safeRows('/v1/reports'),
        apiFetch<Record<string, unknown>>('/v1/reports/operational-summary').catch(() => ({})),
      ]);
      return { source: 'nest', records, summary };
    }
    case 'team':
      return { source: 'nest', records: await safeRows('/v1/organizations/current/members') };
    case 'api-keys':
      return { source: 'nest', records: await safeRows('/v1/auth/api-keys') };
  }
}

async function loadSection(portal: PortalRole, section: OperationsSection): Promise<SectionLoad> {
  const fromDb = await loadOpsRecordsFromDb(portal, section);
  if (fromDb !== null) return { records: fromDb, source: 'db' };

  // On Vercel+Neon, never hang nav on Render Free cold starts for sections without a DB mapper.
  if (hasDatabaseUrl()) {
    const ready = await probeNestHealthz();
    if (!ready) return { records: [], source: 'offline' };
  }

  return loadFromNest(portal, section);
}

export async function loadOperationsWorkspacePayload(
  portal: PortalRole,
  section: OperationsSection,
  localeHint?: 'ar' | 'en',
): Promise<OperationsWorkspacePayload> {
  const locale = localeHint ?? ((await getLocale()) === 'en' ? 'en' : 'ar');
  const nestConfigured = isNestApiConfiguredForRuntime();
  const loaded = await loadSection(portal, section);
  const dataFromDb = loaded.source === 'db';
  const offline = loaded.source === 'offline';

  let contextResult: {
    ok: boolean;
    unauthorized: boolean;
    unreachable: boolean;
    context: OperationsContext;
  } = {
    ok: portal === 'tenant',
    unauthorized: false,
    unreachable: portal !== 'tenant',
    context: {},
  };
  // Skip Nest side-channels when Neon already answered — this was adding ~3.5s per click.
  if (!dataFromDb && !offline && nestConfigured && portal !== 'tenant') {
    const ctx = await Promise.race([
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
            error instanceof ApiError && (error.status === 503 || error.code === 'api_unreachable'),
          context: {},
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
              context: {},
            }),
          NEST_CONTEXT_RACE_MS,
        );
      }),
    ]);
    contextResult = ctx;
  }

  const apiOnline =
    portal === 'tenant'
      ? true
      : dataFromDb || loaded.source === 'nest' || !contextResult.unreachable;
  const context = contextResult.context;
  const recordsEmpty = !loaded.records.length;
  const apiUnauthorized = Boolean(contextResult.unauthorized) && !(dataFromDb && !recordsEmpty);

  return {
    records: loaded.records,
    summary: loaded.summary ?? {},
    secondary: loaded.secondary ?? [],
    context: context as unknown as Record<string, unknown>,
    apiOnline,
    nestConfigured,
    recordsEmpty,
    apiUnauthorized,
    dataFromDb,
    locale,
  };
}

/** Prefetch every ops section for a portal (one Nest health probe, pooled). */
export async function loadAllOperationsWorkspacePayloads(
  portal: PortalRole,
  localeHint?: 'ar' | 'en',
): Promise<Partial<Record<OperationsSection, OperationsWorkspacePayload>>> {
  const sections = opsSectionsForPortal(portal);
  if (!sections.length) return {};

  // Warm Nest health cache once so offline/Neon sections do not re-probe.
  if (hasDatabaseUrl() && isNestApiConfiguredForRuntime()) {
    await probeNestHealthz();
  }

  const out: Partial<Record<OperationsSection, OperationsWorkspacePayload>> = {};
  const concurrency = 4;
  let cursor = 0;

  async function worker() {
    while (cursor < sections.length) {
      const index = cursor;
      cursor += 1;
      const section = sections[index]!;
      out[section] = await loadOperationsWorkspacePayload(portal, section, localeHint);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, sections.length) }, () => worker()));
  return out;
}
