import 'server-only';
import { sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import { platformSettings } from '@bhd-r/db';
import { elevatedTx, rowsOf } from '@/lib/elevated-db';
import {
  EMAIL_TONES,
  defaultGreetingAnonLines,
  defaultGreetingNamedTemplates,
  defaultSparkLines,
  defaultWishLines,
  setEmailWishPoolOverride,
  type EmailTone,
  type EmailWishPoolOverride,
} from '@/lib/email-template';
import type { EmailWishPoolsView } from '@/lib/email-wish-pools-shared';
import { siteAdminAccess } from '@/lib/site-admin-neon';

export type { EmailWishPoolsView } from '@/lib/email-wish-pools-shared';

const STORE_KEY = 'email_wish_pools';

function fail(code: string): never {
  throw new Error(code);
}

async function requireRoot(claims: SessionClaims): Promise<void> {
  const access = await siteAdminAccess(claims);
  if (!access?.root) fail('forbidden');
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const lines = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  return lines.length ? lines : null;
}

function parseOverride(raw: unknown): EmailWishPoolOverride | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  const wishes: EmailWishPoolOverride['wishes'] = {};
  const wishesRaw = body.wishes;
  if (wishesRaw && typeof wishesRaw === 'object') {
    for (const tone of EMAIL_TONES) {
      const lines = asStringArray((wishesRaw as Record<string, unknown>)[tone]);
      if (lines) wishes[tone] = lines;
    }
  }
  return {
    ...(Object.keys(wishes).length ? { wishes } : {}),
    ...(asStringArray(body.sparks) ? { sparks: asStringArray(body.sparks)! } : {}),
    ...(asStringArray(body.greetingsNamed)
      ? { greetingsNamed: asStringArray(body.greetingsNamed)! }
      : {}),
    ...(asStringArray(body.greetingsAnon)
      ? { greetingsAnon: asStringArray(body.greetingsAnon)! }
      : {}),
  };
}

function defaultsView(): EmailWishPoolsView {
  const wishes = {} as Record<EmailTone, string[]>;
  for (const tone of EMAIL_TONES) wishes[tone] = [...defaultWishLines(tone)];
  return {
    wishes,
    sparks: [...defaultSparkLines()],
    greetingsNamed: [...defaultGreetingNamedTemplates()],
    greetingsAnon: [...defaultGreetingAnonLines()],
    usingDefaults: true,
  };
}

function mergeView(override: EmailWishPoolOverride | null): EmailWishPoolsView {
  const base = defaultsView();
  if (!override) return base;
  const wishes = { ...base.wishes };
  for (const tone of EMAIL_TONES) {
    const custom = override.wishes?.[tone];
    if (custom?.length) wishes[tone] = [...custom];
  }
  return {
    wishes,
    sparks: override.sparks?.length ? [...override.sparks] : base.sparks,
    greetingsNamed: override.greetingsNamed?.length
      ? [...override.greetingsNamed]
      : base.greetingsNamed,
    greetingsAnon: override.greetingsAnon?.length
      ? [...override.greetingsAnon]
      : base.greetingsAnon,
    usingDefaults: false,
  };
}

/** Load pools into the in-memory override used by renderBrandedEmail (sync). */
export async function hydrateEmailWishPools(): Promise<void> {
  try {
    const override = await elevatedTx(async (tx) => {
      const [row] = rowsOf<{ value: unknown }>(
        await tx.execute(sql`select value from platform_settings where key = ${STORE_KEY} limit 1`),
      );
      return parseOverride(row?.value ?? null);
    });
    setEmailWishPoolOverride(override);
  } catch {
    /* keep defaults on cold failure */
  }
}

export async function loadEmailWishPools(claims: SessionClaims): Promise<EmailWishPoolsView> {
  await requireRoot(claims);
  return elevatedTx(async (tx) => {
    const [row] = rowsOf<{ value: unknown }>(
      await tx.execute(sql`select value from platform_settings where key = ${STORE_KEY} limit 1`),
    );
    const override = parseOverride(row?.value ?? null);
    setEmailWishPoolOverride(override);
    return mergeView(override);
  });
}

export async function saveEmailWishPools(
  claims: SessionClaims,
  input: {
    wishes: Record<string, string[]>;
    sparks: string[];
    greetingsNamed: string[];
    greetingsAnon: string[];
  },
): Promise<EmailWishPoolsView> {
  await requireRoot(claims);
  const wishes: EmailWishPoolOverride['wishes'] = {};
  for (const tone of EMAIL_TONES) {
    const lines = asStringArray(input.wishes[tone]);
    if (lines) wishes[tone] = lines;
  }
  const override: EmailWishPoolOverride = {
    wishes,
    sparks: asStringArray(input.sparks) ?? [...defaultSparkLines()],
    greetingsNamed: asStringArray(input.greetingsNamed) ?? [...defaultGreetingNamedTemplates()],
    greetingsAnon: asStringArray(input.greetingsAnon) ?? [...defaultGreetingAnonLines()],
  };
  const stored = override as unknown as Record<string, unknown>;
  await elevatedTx(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({
        key: STORE_KEY,
        value: stored,
        updatedByUserId: claims.sub,
      })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: {
          value: stored,
          updatedAt: new Date(),
          updatedByUserId: claims.sub,
        },
      });
  });
  setEmailWishPoolOverride(override);
  return mergeView(override);
}

export async function resetEmailWishPools(claims: SessionClaims): Promise<EmailWishPoolsView> {
  await requireRoot(claims);
  await elevatedTx(async (tx) => {
    await tx.execute(sql`delete from platform_settings where key = ${STORE_KEY}`);
  });
  setEmailWishPoolOverride(null);
  return defaultsView();
}
