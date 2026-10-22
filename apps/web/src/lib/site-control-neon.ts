import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import { isPaymentSandboxPilotEnabled } from '@bhd-r/config';
import { auditLogs, platformSettings } from '@bhd-r/db';
import { encryptField, decryptField, type Keyring } from '@bhd-r/security';
import { elevatedTx, rowsOf, type ElevatedTx } from '@/lib/elevated-db';
import {
  PAYMENT_METHOD_IDS,
  PAYMENT_PROVIDERS,
  credentialsComplete,
  paymentProviderById,
  type PaymentMethodId,
} from '@/lib/payment-gateways-catalog';
import { verifyPaymentProvider } from '@/lib/payment-gateway-adapters';
import { siteAdminAccess } from '@/lib/site-admin-neon';
import type {
  MaintenanceView,
  PaymentGatewaysView,
  PaymentProviderState,
  SitePageId,
  SitePagesView,
} from '@/lib/site-control-shared';
import { SITE_PAGE_IDS } from '@/lib/site-control-shared';

export type {
  MaintenanceView,
  PaymentGatewaysView,
  PaymentProviderState,
  SitePageId,
  SitePagesView,
} from '@/lib/site-control-shared';
export { SITE_PAGE_IDS, SITE_PAGE_META } from '@/lib/site-control-shared';

const PAYMENTS_KEY = 'payment_gateways';
const PAGES_KEY = 'site_pages';
const MAINTENANCE_KEY = 'site_maintenance';

function fail(code: string): never {
  throw new Error(code);
}

async function requireRoot(claims: SessionClaims): Promise<void> {
  const access = await siteAdminAccess(claims);
  if (!access?.root) fail('forbidden');
}

async function requireAnyAdmin(claims: SessionClaims): Promise<void> {
  const access = await siteAdminAccess(claims);
  if (!access) fail('forbidden');
}

async function readSetting(tx: ElevatedTx, key: string): Promise<unknown> {
  const [row] = rowsOf<{ value: unknown }>(
    await tx.execute(sql`select value from platform_settings where key = ${key} limit 1`),
  );
  return row?.value ?? null;
}

async function writeSetting(
  tx: ElevatedTx,
  key: string,
  value: Record<string, unknown>,
  userId: string,
) {
  await tx
    .insert(platformSettings)
    .values({ key, value, updatedByUserId: userId })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: { value, updatedAt: new Date(), updatedByUserId: userId },
    });
}

function paymentKeyring(): Keyring {
  const entries = Object.entries(process.env).filter(
    ([key, value]) => /^FIELD_ENCRYPTION_KEY_V\d+$/.test(key) && value,
  );
  if (entries.length === 0) {
    entries.push(['FIELD_ENCRYPTION_KEY_V1', 'development-field-key-change-in-production']);
  }
  return {
    activeVersion: process.env.FIELD_ENCRYPTION_ACTIVE_VERSION ?? 'v1',
    keys: Object.fromEntries(
      entries.map(([name, value]) => [
        name.replace('FIELD_ENCRYPTION_KEY_', '').toLowerCase(),
        createHash('sha256')
          .update(`${value ?? ''}\0payment-gateway`)
          .digest(),
      ]),
    ),
  };
}

function encryptCredentials(providerId: string, credentials: Record<string, string>): string {
  return encryptField(
    JSON.stringify(credentials),
    paymentKeyring(),
    `platform-gateway:${providerId}`,
  );
}

function decryptCredentials(
  providerId: string,
  encrypted: string | null | undefined,
): Record<string, string> {
  if (!encrypted) return {};
  try {
    const raw = decryptField(encrypted, paymentKeyring(), `platform-gateway:${providerId}`);
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).flatMap(([key, value]) =>
        typeof value === 'string' ? [[key, value]] : [],
      ),
    );
  } catch {
    return {};
  }
}

function maskSecrets(
  providerId: string,
  credentials: Record<string, string>,
): Record<string, string> {
  const def = paymentProviderById(providerId);
  if (!def) return {};
  return Object.fromEntries(
    def.credentialFields.map((field) => {
      const value = credentials[field.key]?.trim() ?? '';
      if (!value) return [field.key, ''];
      if (!field.secret) return [field.key, value];
      if (value.length <= 8) return [field.key, '••••••••'];
      return [field.key, `${value.slice(0, 4)}…${value.slice(-4)}`];
    }),
  );
}

/* ── Payment gateways ───────────────────────────────────────────────────── */

type StoredPayments = {
  providers?: Record<
    string,
    {
      active?: boolean;
      endpoint?: string;
      credentialsEncrypted?: string;
    }
  >;
  methods?: Partial<Record<PaymentMethodId, boolean>>;
  updatedAt?: string;
};

function defaultMethods(): Record<PaymentMethodId, boolean> {
  return {
    card: true,
    apple_pay: false,
    google_pay: false,
    bank_transfer: true,
    cash: true,
  };
}

function buildPaymentsView(stored: StoredPayments | null): PaymentGatewaysView {
  const envSandbox = isPaymentSandboxPilotEnabled();
  const providers = PAYMENT_PROVIDERS.map((def): PaymentProviderState => {
    const row = stored?.providers?.[def.id];
    const credentials = decryptCredentials(def.id, row?.credentialsEncrypted);
    const hasCredentials =
      def.kind === 'sandbox' ? true : credentialsComplete(def, credentials);
    const active =
      row?.active !== undefined
        ? Boolean(row.active)
        : def.id === 'bhd_pay_sandbox'
          ? envSandbox
          : false;
    return {
      id: def.id,
      active,
      endpoint: (row?.endpoint?.trim() || def.defaultEndpoint).slice(0, 500),
      hasCredentials,
      ready: active && hasCredentials,
      credentialsMasked: maskSecrets(def.id, credentials),
      credentialsStored: Boolean(row?.credentialsEncrypted),
    };
  });
  const methods = { ...defaultMethods(), ...(stored?.methods ?? {}) };
  for (const id of PAYMENT_METHOD_IDS) {
    methods[id] = methods[id] !== false;
  }
  return {
    providers,
    methods,
    updatedAt: typeof stored?.updatedAt === 'string' ? stored.updatedAt : null,
  };
}

export function loadPaymentGateways(claims: SessionClaims): Promise<PaymentGatewaysView> {
  return elevatedTx(async (tx) => {
    await requireAnyAdmin(claims);
    const raw = (await readSetting(tx, PAYMENTS_KEY)) as StoredPayments | null;
    return buildPaymentsView(raw);
  });
}

/** Public/server read — no session. Used by payment flows & banners. */
export function readPaymentGatewaysPublic(): Promise<PaymentGatewaysView> {
  return elevatedTx(async (tx) => {
    const raw = (await readSetting(tx, PAYMENTS_KEY)) as StoredPayments | null;
    return buildPaymentsView(raw);
  });
}

export async function isPlatformSandboxPaymentActive(): Promise<boolean> {
  const view = await readPaymentGatewaysPublic();
  const sandbox = view.providers.find((item) => item.id === 'bhd_pay_sandbox');
  if (sandbox) return sandbox.active && sandbox.ready;
  return isPaymentSandboxPilotEnabled();
}

export async function resolveActiveLivePaymentProvider(): Promise<PaymentProviderState | null> {
  const view = await readPaymentGatewaysPublic();
  return (
    view.providers.find(
      (item) => item.id !== 'bhd_pay_sandbox' && item.active && item.ready,
    ) ?? null
  );
}

export type SavePaymentGatewayInput = {
  providerId: string;
  active: boolean;
  endpoint?: string;
  /** Only non-empty fields overwrite stored secrets; omit or leave blank to keep. */
  credentials?: Record<string, string>;
};

export type SavePaymentMethodsInput = {
  methods: Record<PaymentMethodId, boolean>;
};

export function savePaymentGateway(
  claims: SessionClaims,
  input: SavePaymentGatewayInput,
): Promise<PaymentGatewaysView> {
  return elevatedTx(async (tx) => {
    await requireRoot(claims);
    const def = paymentProviderById(input.providerId);
    if (!def) fail('invalid_body');

    const raw = ((await readSetting(tx, PAYMENTS_KEY)) as StoredPayments | null) ?? {};
    const providers = { ...(raw.providers ?? {}) };
    const previous = providers[def.id] ?? {};
    const existingCreds = decryptCredentials(def.id, previous.credentialsEncrypted);
    const nextCreds = { ...existingCreds };
    for (const field of def.credentialFields) {
      const incoming = input.credentials?.[field.key];
      if (typeof incoming === 'string' && incoming.trim() && !incoming.includes('…')) {
        nextCreds[field.key] = incoming.trim().slice(0, 500);
      }
    }

    if (input.active && def.kind === 'live' && !credentialsComplete(def, nextCreds)) {
      fail('gateway_keys_required');
    }

    const endpoint = (input.endpoint?.trim() || previous.endpoint || def.defaultEndpoint).slice(
      0,
      500,
    );

    // Live gateways: require complete keys; ping is advisory (401 still blocks activate).
    if (input.active && def.kind === 'live') {
      const verified = await verifyPaymentProvider(def.id, endpoint, nextCreds);
      if (
        !verified.ok &&
        /rejected|مرفوض|401|403/i.test(`${verified.detailEn} ${verified.detailAr}`)
      ) {
        fail('gateway_verify_failed');
      }
    }

    providers[def.id] = {
      active: Boolean(input.active),
      endpoint,
      ...(def.credentialFields.length
        ? { credentialsEncrypted: encryptCredentials(def.id, nextCreds) }
        : previous.credentialsEncrypted
          ? { credentialsEncrypted: previous.credentialsEncrypted }
          : {}),
    };

    const value: StoredPayments = {
      providers,
      methods: raw.methods ?? defaultMethods(),
      updatedAt: new Date().toISOString(),
    };
    await writeSetting(tx, PAYMENTS_KEY, value, claims.sub);
    await tx.insert(auditLogs).values({
      organizationId: null,
      actorUserId: claims.sub,
      action: 'site.payment_gateway.save',
      resourceType: 'payment_gateway',
      resourceId: null,
      requestId: randomUUID(),
      metadata: { providerId: def.id, active: input.active },
    });
    return buildPaymentsView(value);
  });
}

export function savePaymentMethods(
  claims: SessionClaims,
  input: SavePaymentMethodsInput,
): Promise<PaymentGatewaysView> {
  return elevatedTx(async (tx) => {
    await requireRoot(claims);
    const raw = ((await readSetting(tx, PAYMENTS_KEY)) as StoredPayments | null) ?? {};
    const methods = defaultMethods();
    for (const id of PAYMENT_METHOD_IDS) {
      methods[id] = input.methods[id] !== false;
    }
    const value: StoredPayments = {
      providers: raw.providers ?? {},
      methods,
      updatedAt: new Date().toISOString(),
    };
    await writeSetting(tx, PAYMENTS_KEY, value, claims.sub);
    await tx.insert(auditLogs).values({
      organizationId: null,
      actorUserId: claims.sub,
      action: 'site.payment_methods.save',
      resourceType: 'payment_methods',
      resourceId: null,
      requestId: randomUUID(),
      metadata: { methods },
    });
    return buildPaymentsView(value);
  });
}

/** Decrypt credentials for a ready provider (server payment adapters). */
export function readProviderCredentials(providerId: string): Promise<Record<string, string>> {
  return elevatedTx(async (tx) => {
    const raw = (await readSetting(tx, PAYMENTS_KEY)) as StoredPayments | null;
    return decryptCredentials(providerId, raw?.providers?.[providerId]?.credentialsEncrypted);
  });
}

/* ── Site pages ─────────────────────────────────────────────────────────── */

function defaultPages(): Record<SitePageId, boolean> {
  return Object.fromEntries(SITE_PAGE_IDS.map((id) => [id, true])) as Record<SitePageId, boolean>;
}

function buildPagesView(
  stored: { pages?: Partial<Record<SitePageId, boolean>>; updatedAt?: string | null } | null,
): SitePagesView {
  const pages = defaultPages();
  for (const id of SITE_PAGE_IDS) {
    if (stored?.pages && id in stored.pages) pages[id] = stored.pages[id] !== false;
  }
  // Login stays available so the site remains reachable for admins / SSO.
  pages.login = true;
  pages.home = pages.home !== false;
  return {
    pages,
    updatedAt: typeof stored?.updatedAt === 'string' ? stored.updatedAt : null,
  };
}

export function loadSitePages(claims: SessionClaims): Promise<SitePagesView> {
  return elevatedTx(async (tx) => {
    await requireAnyAdmin(claims);
    return buildPagesView(
      (await readSetting(tx, PAGES_KEY)) as {
        pages?: Partial<Record<SitePageId, boolean>>;
        updatedAt?: string | null;
      } | null,
    );
  });
}

export function readSitePagesPublic(): Promise<SitePagesView> {
  return elevatedTx(async (tx) =>
    buildPagesView(
      (await readSetting(tx, PAGES_KEY)) as {
        pages?: Partial<Record<SitePageId, boolean>>;
        updatedAt?: string | null;
      } | null,
    ),
  );
}

export function saveSitePages(
  claims: SessionClaims,
  pages: Record<SitePageId, boolean>,
): Promise<SitePagesView> {
  return elevatedTx(async (tx) => {
    await requireRoot(claims);
    const next = defaultPages();
    for (const id of SITE_PAGE_IDS) next[id] = pages[id] !== false;
    next.login = true;
    const value = { pages: next, updatedAt: new Date().toISOString() };
    await writeSetting(tx, PAGES_KEY, value, claims.sub);
    await tx.insert(auditLogs).values({
      organizationId: null,
      actorUserId: claims.sub,
      action: 'site.pages.save',
      resourceType: 'site_pages',
      resourceId: null,
      requestId: randomUUID(),
      metadata: { pages: next },
    });
    return buildPagesView(value);
  });
}

export async function isSitePageEnabled(pageId: SitePageId): Promise<boolean> {
  const view = await readSitePagesPublic();
  return view.pages[pageId] !== false;
}

/* ── Maintenance ────────────────────────────────────────────────────────── */

const DEFAULT_MAINTENANCE: MaintenanceView = {
  enabled: false,
  mode: 'banner',
  messageAr: 'نقوم حالياً بأعمال صيانة قصيرة. شكراً لصبركم.',
  messageEn: 'We are performing brief maintenance. Thank you for your patience.',
  updatedAt: null,
};

function buildMaintenanceView(stored: Partial<MaintenanceView> | null): MaintenanceView {
  return {
    enabled: Boolean(stored?.enabled),
    mode: stored?.mode === 'hard' ? 'hard' : 'banner',
    messageAr:
      typeof stored?.messageAr === 'string' && stored.messageAr.trim()
        ? stored.messageAr.trim().slice(0, 500)
        : DEFAULT_MAINTENANCE.messageAr,
    messageEn:
      typeof stored?.messageEn === 'string' && stored.messageEn.trim()
        ? stored.messageEn.trim().slice(0, 500)
        : DEFAULT_MAINTENANCE.messageEn,
    updatedAt: typeof stored?.updatedAt === 'string' ? stored.updatedAt : null,
  };
}

export function loadMaintenance(claims: SessionClaims): Promise<MaintenanceView> {
  return elevatedTx(async (tx) => {
    await requireAnyAdmin(claims);
    return buildMaintenanceView((await readSetting(tx, MAINTENANCE_KEY)) as MaintenanceView | null);
  });
}

export function readMaintenancePublic(): Promise<MaintenanceView> {
  return elevatedTx(async (tx) =>
    buildMaintenanceView((await readSetting(tx, MAINTENANCE_KEY)) as MaintenanceView | null),
  );
}

export function saveMaintenance(
  claims: SessionClaims,
  input: Omit<MaintenanceView, 'updatedAt'>,
): Promise<MaintenanceView> {
  return elevatedTx(async (tx) => {
    await requireRoot(claims);
    const value = {
      ...buildMaintenanceView(input),
      updatedAt: new Date().toISOString(),
    };
    await writeSetting(tx, MAINTENANCE_KEY, value, claims.sub);
    await tx.insert(auditLogs).values({
      organizationId: null,
      actorUserId: claims.sub,
      action: 'site.maintenance.save',
      resourceType: 'site_maintenance',
      resourceId: null,
      requestId: randomUUID(),
      metadata: { enabled: value.enabled, mode: value.mode },
    });
    return value;
  });
}
