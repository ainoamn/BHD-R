import 'server-only';
import { getLocale } from 'next-intl/server';
import { ApiError } from '@/lib/api';
import { activeBadgeChips, chipsOf, type BadgeRef } from '@/lib/badge-chips-neon';
import type { BadgeChip } from '@/lib/badges-shared';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { withTimeoutFallback } from '@/lib/with-timeout';
import { apiFetch, configuredApiOrigin, isNestApiConfiguredForRuntime } from '@/lib/server-api';
import {
  clearOpsContextDbCache,
  loadOpsContextFromDb,
  loadOpsRecordsFromDb,
} from '@/lib/portal-ops-data';
import { loadOpsSectionFromNeon } from '@/lib/portal-ops-sections-neon';
import { loadStayIncomeRowsForViewer } from '@/lib/stay-deposit-ledger-neon';
import { loadStayBookingOpsRows, tagLeaseBookingPurpose } from '@/lib/unified-bookings';
import type { PortalRole } from '@/lib/types';
import type { OperationsContext } from '@/components/operations-console';
import type { OperationsSection, OperationsWorkspacePayload } from '@/lib/portal-ops-types';
import { opsSectionsForPortal } from '@/lib/portal-ops-types';
import { canOpenSection, scopedOwnerParty, type PortalAccess } from '@/lib/portal-access';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';

export type { OperationsSection, OperationsWorkspacePayload } from '@/lib/portal-ops-types';
export { isOperationsSection, OPERATIONS_SECTIONS } from '@/lib/portal-ops-types';

type DataRow = Record<string, unknown>;
type SectionLoad = {
  records: DataRow[];
  source: 'db' | 'offline' | 'nest';
  summary?: Record<string, unknown>;
  secondary?: DataRow[];
  contextPatch?: Record<string, unknown>;
};
type OperationsContextResult = {
  ok: boolean;
  unauthorized: boolean;
  unreachable: boolean;
  context: OperationsContext;
};

const NEST_PROBE_MS = 1_500;
const NEST_ROW_RACE_MS = 2_500;
const NEST_CONTEXT_RACE_MS = 2_000;
const NEST_HEALTH_TTL_MS = 10_000;

/** Context lists a member only sees with the matching read permission. */
const CONTEXT_KEY_PERMISSIONS: readonly (readonly [string, readonly string[]])[] = [
  ['party.read', ['parties', 'owners', 'tenants']],
  [
    'lease.read',
    ['leases', 'cancelRequestedLeases', 'clearancePendingLeases', 'renewalPendingLeases'],
  ],
  ['invoice.read', ['invoices']],
  ['accounting.read', ['ledgerAccounts']],
  ['reservation.read', ['reservations', 'pendingDepositReservations', 'confirmedReservations']],
  ['contract.template.read', ['contractTemplates']],
];

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

function preferNestFixtures(): boolean {
  // Bracket access + trim: avoid build-time inlining of a missing env to undefined.
  return String(process.env['E2E_FORCE_NEST_FIXTURES'] ?? '').trim() === '1';
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
    // Promise.race — AbortSignal alone can hang through Render cold starts.
    const response = await Promise.race([
      fetch(`${origin}/healthz`, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(NEST_PROBE_MS),
      }),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), NEST_PROBE_MS);
      }),
    ]);
    const ok = Boolean(response && response.ok);
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
      const [reservations, viewings, holds, stayRows] = await Promise.all([
        safeRows('/v1/leasing/reservations'),
        safeRows('/v1/operations/viewings'),
        safeRows('/v1/leasing/holds'),
        isStaysPlatformEnabled()
          ? loadStayBookingOpsRows({ limit: 80 }).catch(() => [] as Record<string, unknown>[])
          : Promise.resolve([] as Record<string, unknown>[]),
      ]);
      const leaseRows = [
        ...reservations.map((row) => tagLeaseBookingPurpose({ ...row, recordKind: 'reservation' })),
        ...viewings.map((row) => tagLeaseBookingPurpose({ ...row, recordKind: 'viewing' })),
        ...holds.map((row) => tagLeaseBookingPurpose({ ...row, recordKind: 'hold' })),
      ];
      const fromDb = stayRows.length > 0;
      return {
        source:
          fromDb && !leaseRows.length ? 'db' : leaseRows.length ? 'nest' : fromDb ? 'db' : 'nest',
        records: [...stayRows, ...leaseRows],
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
      const [records, dashboard, chequeRows, invoiceRows, stayPayments, ledgerAccounts] =
        await Promise.all([
          safeRows('/v1/accounting/journals'),
          apiFetch<Record<string, unknown>>('/v1/accounting/dashboard').catch(() => ({})),
          safeRows('/v1/finance/cheques'),
          safeRows('/v1/finance/invoices'),
          loadStayIncomeRowsForViewer().catch(() => [] as Record<string, unknown>[]),
          safeRows('/v1/accounting/accounts'),
        ]);
      return {
        source: 'nest',
        records: [...stayPayments, ...records],
        summary: {
          ...dashboard,
          activeLeaseInvoices: invoiceRows.filter((row) => row.leaseId && row.status !== 'void')
            .length,
          stayPaymentsCollected: stayPayments.filter((row) => row.recordKind === 'stay_payment')
            .length,
          pendingCheques: chequeRows.filter((row) => row.reviewStatus === 'pending').length,
        },
        secondary: [
          ...chequeRows.map((row) => ({ ...row, recordKind: 'cheque', status: row.reviewStatus })),
          ...invoiceRows
            .filter((row) => row.leaseId)
            .map((row) => ({ ...row, recordKind: 'lease_invoice' })),
          ...stayPayments,
        ],
        contextPatch: { ledgerAccounts },
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

/** In-process smoke rows for E2E_FORCE — avoid Nest/cookies races on parallel section loads. */
function e2eSmokeRecords(section: OperationsSection): Record<string, unknown>[] | null {
  switch (section) {
    case 'requests':
      return [
        {
          id: 'req-1',
          reference: 'REQ-2026-0142',
          subject: 'تحديث بيانات المستأجر',
          type: 'customer_service',
          priority: 'normal',
          status: 'in_progress',
          dueAt: '2026-08-25T09:00:00.000Z',
        },
      ];
    case 'bookings':
      return [
        {
          id: 'view-1',
          reference: 'VIEW-0041',
          unitId: '00000000-0000-4000-8000-000000000010',
          status: 'scheduled',
          scheduledAt: '2026-08-26T14:30:00.000Z',
          recordKind: 'viewing',
          bookingPurpose: 'monthly',
        },
      ];
    case 'sales':
      return [
        {
          id: 'sale-1',
          reference: 'SALE-2026-008',
          propertyId: '00000000-0000-4000-8000-000000000011',
          status: 'negotiation',
          askingPriceMinor: '125000000',
          agreedPriceMinor: '121000000',
          currency: 'OMR',
          expectedClosingOn: '2026-09-15',
        },
      ];
    case 'accounting':
      return [
        {
          id: 'journal-1',
          reference: 'JV-2026-0038',
          occurredOn: '2026-08-18',
          description: 'تحصيل إيجار أغسطس',
          debitMinor: '175000',
          creditMinor: '175000',
          currency: 'OMR',
          status: 'posted',
        },
      ];
    case 'work-orders':
      return [
        {
          id: 'wo-1',
          reference: 'WO-2026-0077',
          title: 'استبدال مضخة المياه',
          estimatedCostMinor: '85000',
          currency: 'OMR',
          status: 'approved',
          scheduledFor: '2026-08-24T07:00:00.000Z',
        },
      ];
    case 'legal':
      return [
        {
          id: 'legal-1',
          reference: 'LEG-2026-0014',
          title: 'متابعة إشعار قانوني',
          caseType: 'notice',
          status: 'in_progress',
          nextHearingAt: '2026-09-02T06:00:00.000Z',
          claimedAmountMinor: '900000',
          currency: 'OMR',
        },
      ];
    default:
      return null;
  }
}

async function loadSection(portal: PortalRole, section: OperationsSection): Promise<SectionLoad> {
  // Playwright CI: serve in-process smoke rows (Nest mock can race on parallel cookies/fetch).
  if (preferNestFixtures()) {
    const smoke = e2eSmokeRecords(section);
    if (smoke) return { records: smoke, source: 'nest' };
    return loadFromNest(portal, section);
  }

  const fromDb = await loadOpsRecordsFromDb(portal, section);
  if (fromDb !== null) return { records: fromDb, source: 'db' };
  const fromNeon = await loadOpsSectionFromNeon(portal, section);
  if (fromNeon !== null) return { ...fromNeon, source: 'db' };

  // Unified bookings: daily stays from Neon even when Nest is asleep.
  if (section === 'bookings' && (portal === 'owner' || portal === 'developer')) {
    if (hasDatabaseUrl()) {
      const ready = await probeNestHealthz();
      if (!ready) {
        const stayRows = isStaysPlatformEnabled()
          ? await loadStayBookingOpsRows({ limit: 80 }).catch(() => [] as Record<string, unknown>[])
          : [];
        return {
          records: stayRows,
          source: stayRows.length ? 'db' : 'offline',
        };
      }
    }
    return loadFromNest(portal, section);
  }

  // Accounting: always paint Neon stay rows first. Nest journals are optional
  // enrichment with a hard ceiling so Render cold starts cannot block the page.
  if (hasDatabaseUrl() && section === 'accounting') {
    const stayPayments = await loadStayIncomeRowsForViewer();
    const nestEnrichment = await Promise.race([
      (async () => {
        const ready = await probeNestHealthz();
        if (!ready) return null;
        const [journals, dashboard, chequeRows, invoiceRows, ledgerAccounts] = await Promise.all([
          safeRows('/v1/accounting/journals'),
          apiFetch<Record<string, unknown>>('/v1/accounting/dashboard').catch(() => ({})),
          safeRows('/v1/finance/cheques'),
          safeRows('/v1/finance/invoices'),
          safeRows('/v1/accounting/accounts'),
        ]);
        return { journals, dashboard, chequeRows, invoiceRows, ledgerAccounts };
      })(),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), 1_200);
      }),
    ]);

    if (nestEnrichment) {
      return {
        source: stayPayments.length ? 'db' : 'nest',
        records: [...stayPayments, ...nestEnrichment.journals],
        summary: {
          ...nestEnrichment.dashboard,
          activeLeaseInvoices: nestEnrichment.invoiceRows.filter(
            (row) => row.leaseId && row.status !== 'void',
          ).length,
          stayPaymentsCollected: stayPayments.filter((row) => row.recordKind === 'stay_payment')
            .length,
          pendingCheques: nestEnrichment.chequeRows.filter((row) => row.reviewStatus === 'pending')
            .length,
        },
        secondary: [
          ...nestEnrichment.chequeRows.map((row) => ({
            ...row,
            recordKind: 'cheque',
            status: row.reviewStatus,
          })),
          ...nestEnrichment.invoiceRows
            .filter((row) => row.leaseId)
            .map((row) => ({ ...row, recordKind: 'lease_invoice' })),
          ...stayPayments,
        ],
        contextPatch: { ledgerAccounts: nestEnrichment.ledgerAccounts },
      };
    }

    return {
      records: stayPayments,
      source: stayPayments.length ? 'db' : 'offline',
      summary: {
        stayPaymentsCollected: stayPayments.filter((row) => row.recordKind === 'stay_payment')
          .length,
      },
      secondary: stayPayments,
    };
  }

  // On Vercel+Neon, never hang nav on Render Free cold starts for sections without a DB mapper.
  if (hasDatabaseUrl()) {
    const ready = await probeNestHealthz();
    if (!ready) return { records: [], source: 'offline' };
  }

  return loadFromNest(portal, section);
}

async function loadOperationsContext(): Promise<OperationsContextResult> {
  return Promise.race([
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
    new Promise<OperationsContextResult>((resolve) => {
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
}

/** Buildings' and tenants' current awards on the rows that name them. */
async function withSectionBadges(
  section: OperationsSection,
  records: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  if (!records.length || (section !== 'properties' && section !== 'contracts')) return records;
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  const refs: BadgeRef[] =
    section === 'properties'
      ? records
          .filter((row) => !row.parentPropertyId)
          .map((row) => ({ type: 'property', id: text(row.id) }))
      : records.flatMap((row): BadgeRef[] => [
          { type: 'property', id: text(row.propertyId) },
          { type: 'tenant', id: text(row.tenantPartyId) },
        ]);
  const chips = await withTimeoutFallback(
    activeBadgeChips(refs),
    2_000,
    new Map<string, BadgeChip[]>(),
    'ops-badges',
  );
  if (!chips.size) return records;
  return records.map((row) => {
    if (section === 'properties') {
      const badges = row.parentPropertyId ? [] : chipsOf(chips, 'property', text(row.id));
      return badges.length ? { ...row, badges } : row;
    }
    const propertyBadges = chipsOf(chips, 'property', text(row.propertyId));
    const tenantBadges = chipsOf(chips, 'tenant', text(row.tenantPartyId));
    return propertyBadges.length || tenantBadges.length
      ? { ...row, propertyBadges, tenantBadges }
      : row;
  });
}

export async function loadOperationsWorkspacePayload(
  portal: PortalRole,
  section: OperationsSection,
  access: PortalAccess,
  localeHint?: 'ar' | 'en',
  contextHint?: OperationsContextResult,
): Promise<OperationsWorkspacePayload> {
  const locale = localeHint ?? ((await getLocale()) === 'en' ? 'en' : 'ar');
  const nestConfigured = isNestApiConfiguredForRuntime();
  // Playwright: never take the scoped-owner empty short-circuit — use Nest fixtures.
  if (preferNestFixtures()) {
    const loaded = await loadSection(portal, section);
    // Skip Neon badge enrichment in fixture mode — no DB required for smoke rows.
    const records = hasDatabaseUrl()
      ? await withSectionBadges(section, loaded.records)
      : loaded.records;
    return {
      records,
      summary: loaded.summary ?? {},
      secondary: loaded.secondary ?? [],
      context: loaded.contextPatch ?? {},
      apiOnline: true,
      nestConfigured: true,
      recordsEmpty: !records.length,
      apiUnauthorized: false,
      dataFromDb: false,
      loadError: false,
      locale,
    };
  }
  if (portal !== 'tenant' && scopedOwnerParty(access)) {
    // Building owners: properties + bookings/viewings for their buildings only (not Nest org-wide).
    if (section === 'properties') {
      const records = await withSectionBadges(
        section,
        (await loadOpsRecordsFromDb(portal, section)) ?? [],
      );
      return {
        records,
        summary: {},
        secondary: [],
        context: {},
        apiOnline: true,
        nestConfigured,
        recordsEmpty: !records.length,
        apiUnauthorized: false,
        dataFromDb: true,
        loadError: false,
        locale,
      };
    }
    if (section === 'bookings' && (portal === 'owner' || portal === 'developer')) {
      // Neon-only, owner-scoped list — avoid the heavy property-records pack + badges.
      const fromNeon = await loadOpsSectionFromNeon(portal, section);
      const records = fromNeon?.records ?? [];
      return {
        records,
        summary: {},
        secondary: [],
        context: {},
        apiOnline: true,
        nestConfigured,
        recordsEmpty: !records.length,
        apiUnauthorized: false,
        dataFromDb: true,
        loadError: false,
        locale,
      };
    }
    return {
      records: [],
      summary: {},
      secondary: [],
      context: {},
      apiOnline: true,
      nestConfigured,
      recordsEmpty: true,
      apiUnauthorized: false,
      dataFromDb: true,
      loadError: false,
      locale,
    };
  }
  if (
    section === 'bookings' ||
    section === 'leasing' ||
    section === 'contracts' ||
    section === 'payments'
  ) {
    clearOpsContextDbCache();
  }

  // Skip heavy ops context on list pages that do not need create-form dropdowns
  // on first paint. Bookings still wants vacantUnits when available, but must not
  // wait on a cold context load (was up to ~1.8s).
  const needsOpsContext =
    portal !== 'tenant' &&
    section !== 'properties' &&
    section !== 'approvals' &&
    section !== 'team' &&
    section !== 'api-keys';
  const contextBudgetMs = section === 'bookings' ? 350 : 1_800;
  const neonContextPromise: Promise<Record<string, unknown> | null> = needsOpsContext
    ? Promise.race([
        loadOpsContextFromDb(portal).catch(() => null),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), contextBudgetMs);
        }),
      ])
    : Promise.resolve(null);
  const [loaded, neonContext] = await Promise.all([
    loadSection(portal, section),
    neonContextPromise,
  ]);

  const dataFromDb = loaded.source === 'db';
  const offline = loaded.source === 'offline';

  let contextResult: OperationsContextResult = {
    ok: portal === 'tenant',
    unauthorized: false,
    unreachable: portal !== 'tenant',
    context: {},
  };
  // Skip Nest side-channels when Neon already answered — this was adding ~3.5s per click.
  if (!dataFromDb && !offline && nestConfigured && portal !== 'tenant') {
    contextResult = contextHint ?? (await loadOperationsContext());
  }

  const apiOnline =
    portal === 'tenant'
      ? true
      : // Nest-asleep empty shell: do not mark the whole portal "offline" (triggers re-login banner).
        offline
        ? true
        : dataFromDb || loaded.source === 'nest' || !contextResult.unreachable;
  const nestContext = contextResult.context as Record<string, unknown>;
  // Neon context fills vacantUnits/properties/parties when Nest is asleep or skipped.
  // Nest wins on overlapping keys when both are present.
  const context = {
    ...(neonContext ?? {}),
    ...nestContext,
    vacantUnits:
      (Array.isArray(nestContext.vacantUnits) && nestContext.vacantUnits.length
        ? nestContext.vacantUnits
        : neonContext?.vacantUnits) ?? [],
    units:
      (Array.isArray(nestContext.units) && nestContext.units.length
        ? nestContext.units
        : neonContext?.units) ?? [],
    properties:
      (Array.isArray(nestContext.properties) && nestContext.properties.length
        ? nestContext.properties
        : neonContext?.properties) ?? [],
    parties:
      (Array.isArray(nestContext.parties) && nestContext.parties.length
        ? nestContext.parties
        : neonContext?.parties) ?? [],
    tenants:
      (Array.isArray(nestContext.tenants) && nestContext.tenants.length
        ? nestContext.tenants
        : neonContext?.tenants) ?? [],
    owners:
      (Array.isArray(nestContext.owners) && nestContext.owners.length
        ? nestContext.owners
        : neonContext?.owners) ?? [],
    ...(loaded.contextPatch ?? {}),
  };
  for (const [permission, keys] of CONTEXT_KEY_PERMISSIONS) {
    if (access.permissions.includes(permission)) continue;
    for (const key of keys) delete (context as Record<string, unknown>)[key];
  }
  const recordsEmpty = !loaded.records.length;
  const loadError = offline && recordsEmpty;
  const apiUnauthorized = Boolean(contextResult.unauthorized) && !(dataFromDb && !recordsEmpty);

  return {
    records: await withSectionBadges(section, loaded.records),
    summary: loaded.summary ?? {},
    secondary: loaded.secondary ?? [],
    context,
    apiOnline,
    nestConfigured,
    recordsEmpty,
    apiUnauthorized,
    dataFromDb,
    loadError,
    locale,
  };
}

/** Prefetch every ops section for a portal (one Nest health probe, pooled). */
export async function loadAllOperationsWorkspacePayloads(
  portal: PortalRole,
  access: PortalAccess,
  localeHint?: 'ar' | 'en',
): Promise<Partial<Record<OperationsSection, OperationsWorkspacePayload>>> {
  const sections = opsSectionsForPortal(portal).filter((section) =>
    canOpenSection(access, portal, section),
  );
  if (!sections.length) return {};

  // Warm Nest health cache once so offline/Neon sections do not re-probe.
  let nestReady = true;
  if (hasDatabaseUrl() && isNestApiConfiguredForRuntime()) {
    nestReady = await probeNestHealthz();
  }

  // Context is identical for all section forms; fetching it once avoids up to
  // nineteen duplicate Render requests during background warm-up.
  const sharedContext =
    portal !== 'tenant' && isNestApiConfiguredForRuntime() && nestReady
      ? await loadOperationsContext()
      : undefined;

  const out: Partial<Record<OperationsSection, OperationsWorkspacePayload>> = {};
  const concurrency = 4;
  let cursor = 0;

  async function worker() {
    while (cursor < sections.length) {
      const index = cursor;
      cursor += 1;
      const section = sections[index]!;
      out[section] = await loadOperationsWorkspacePayload(
        portal,
        section,
        access,
        localeHint,
        sharedContext,
      );
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, sections.length) }, () => worker()));
  return out;
}
