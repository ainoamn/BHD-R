import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import { auditLogs, memberships, parties, platformSettings, users } from '@bhd-r/db';
import { elevatedTx, rowsOf, type ElevatedTx } from '@/lib/elevated-db';
import { appLink, emailableAddress, queueBrandedEmail } from '@/lib/email-notify';
import { sendQueuedEmailsSoon } from '@/lib/email-outbox';
import {
  generateGreetingDesign,
  greetingCardPublicUrl,
} from '@/lib/greeting-card-ai';
import {
  emptyGreetingAudience,
  isGreetingAudience,
  type GreetingAudience,
  type GreetingAudienceEstimate,
  type GreetingCampaign,
  type GreetingCampaignsStore,
  type GreetingCampaignStatus,
  type GreetingDesignVersion,
} from '@/lib/greeting-campaigns-shared';
import { siteAdminAccess } from '@/lib/site-admin-neon';

const STORE_KEY = 'greeting_campaigns';
const MAX_CAMPAIGNS = 80;
const MAX_DESIGNS = 8;
const SEND_BATCH = 80;

function fail(code: string): never {
  throw new Error(code);
}

async function requireRoot(claims: SessionClaims): Promise<void> {
  const access = await siteAdminAccess(claims);
  if (!access?.root) fail('forbidden');
}

async function readStore(tx: ElevatedTx): Promise<GreetingCampaignsStore> {
  const [row] = rowsOf<{ value: unknown }>(
    await tx.execute(sql`select value from platform_settings where key = ${STORE_KEY} limit 1`),
  );
  const raw = row?.value as GreetingCampaignsStore | null;
  if (!raw || !Array.isArray(raw.campaigns)) {
    return { campaigns: [], updatedAt: new Date(0).toISOString() };
  }
  return {
    campaigns: raw.campaigns.filter(isCampaign),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
  };
}

async function writeStore(tx: ElevatedTx, store: GreetingCampaignsStore, userId: string | null) {
  const value = {
    campaigns: store.campaigns.slice(0, MAX_CAMPAIGNS),
    updatedAt: new Date().toISOString(),
  } as GreetingCampaignsStore & Record<string, unknown>;
  await tx
    .insert(platformSettings)
    .values({ key: STORE_KEY, value, updatedByUserId: userId })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: { value, updatedByUserId: userId, updatedAt: new Date() },
    });
}

function isCampaign(value: unknown): value is GreetingCampaign {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<GreetingCampaign>;
  return (
    typeof row.id === 'string' &&
    typeof row.occasion === 'string' &&
    typeof row.occasionDate === 'string' &&
    isGreetingAudience(row.audience) &&
    Array.isArray(row.designs)
  );
}

function muscatNineAm(dateYmd: string): string {
  // Asia/Muscat is UTC+4 year-round.
  const [y, m, d] = dateYmd.split('-').map(Number);
  if (!y || !m || !d) fail('invalid_body');
  return new Date(Date.UTC(y, m - 1, d, 5, 0, 0)).toISOString();
}

function normalizeAudience(raw: unknown): GreetingAudience {
  if (!isGreetingAudience(raw)) return emptyGreetingAudience();
  return {
    locales: raw.locales.filter((l): l is 'ar' | 'en' => l === 'ar' || l === 'en').slice(0, 2),
    roles: raw.roles
      .filter((r): r is GreetingAudience['roles'][number] =>
        ['all', 'tenant', 'owner', 'staff'].includes(r),
      )
      .slice(0, 4),
    nationalities: raw.nationalities
      .map((c) => String(c).trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 12),
    genders: raw.genders.filter((g): g is 'male' | 'female' => g === 'male' || g === 'female'),
    ages: raw.ages.filter((a): a is 'youth' | 'adult' | 'senior' =>
      ['youth', 'adult', 'senior'].includes(a),
    ),
  };
}

function metaString(meta: unknown, keys: string[]): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const obj = meta as Record<string, unknown>;
  for (const key of keys) {
    const direct = obj[key];
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
  }
  const person = obj.person;
  if (person && typeof person === 'object') {
    for (const key of keys) {
      const nested = (person as Record<string, unknown>)[key];
      if (typeof nested === 'string' && nested.trim()) return nested.trim();
    }
  }
  return null;
}

function ageBand(birth: string | null): 'youth' | 'adult' | 'senior' | null {
  if (!birth) return null;
  const date = new Date(birth);
  if (Number.isNaN(date.getTime())) {
    const year = Number(birth);
    if (!Number.isFinite(year) || year < 1920 || year > 2015) return null;
    const age = new Date().getFullYear() - year;
    if (age < 36) return 'youth';
    if (age < 60) return 'adult';
    return 'senior';
  }
  const ageMs = Date.now() - date.getTime();
  const age = ageMs / (365.25 * 24 * 3600 * 1000);
  if (age < 18) return null;
  if (age < 36) return 'youth';
  if (age < 60) return 'adult';
  return 'senior';
}

type AudienceRow = {
  userId: string;
  email: string;
  displayName: string;
  locale: string;
  roleKey: string | null;
  metadata: unknown;
};

function matchesAudience(row: AudienceRow, audience: GreetingAudience): boolean {
  if (audience.locales.length && !audience.locales.includes(row.locale === 'en' ? 'en' : 'ar')) {
    return false;
  }

  if (audience.roles.length && !audience.roles.includes('all')) {
    const role = (row.roleKey ?? '').toLowerCase();
    const isOwner =
      role.includes('owner') || role.includes('organization_admin') || role.includes('property_manager');
    const isTenant = role.includes('tenant') || role.includes('resident') || role.includes('guest');
    const isStaff =
      role.includes('staff') ||
      role.includes('guard') ||
      role.includes('custom:') ||
      role.includes('accountant');
    const ok = audience.roles.some((wanted) => {
      if (wanted === 'owner') return isOwner;
      if (wanted === 'tenant') return isTenant;
      if (wanted === 'staff') return isStaff;
      return false;
    });
    if (!ok) return false;
  }

  if (audience.nationalities.length) {
    const code = (metaString(row.metadata, ['nationality', 'nationalityCode', 'countryCode']) ?? '')
      .toUpperCase()
      .slice(0, 2);
    if (!code) return false;
    const ok = audience.nationalities.some((wanted) => {
      if (wanted === 'OM') return code === 'OM';
      if (wanted === 'EXPAT') return code !== 'OM';
      return code === wanted;
    });
    if (!ok) return false;
  }

  if (audience.genders.length) {
    const gender = (metaString(row.metadata, ['gender', 'sex']) ?? '').toLowerCase();
    if (!gender) return false;
    const normalized =
      gender.startsWith('m') || gender === 'ذكر' || gender === 'رجل'
        ? 'male'
        : gender.startsWith('f') || gender === 'أنثى' || gender === 'امرأة'
          ? 'female'
          : null;
    if (!normalized || !audience.genders.includes(normalized)) return false;
  }

  if (audience.ages.length) {
    const birth = metaString(row.metadata, ['dateOfBirth', 'birthDate', 'birthYear', 'dob']);
    const band = ageBand(birth);
    if (!band || !audience.ages.includes(band)) return false;
  }

  return true;
}

async function loadAudienceRows(tx: ElevatedTx): Promise<AudienceRow[]> {
  const rows = await tx
    .select({
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      locale: users.locale,
      roleKey: memberships.roleKey,
      metadata: parties.metadata,
    })
    .from(users)
    .leftJoin(
      memberships,
      and(eq(memberships.userId, users.id), eq(memberships.status, 'active')),
    )
    .leftJoin(parties, eq(parties.id, memberships.partyId))
    .where(isNull(users.disabledAt))
    .limit(5000);

  // Collapse to one row per user (keep first membership + party metadata).
  const byUser = new Map<string, AudienceRow>();
  for (const row of rows) {
    const existing = byUser.get(row.userId);
    if (!existing) {
      byUser.set(row.userId, row);
      continue;
    }
    if (!existing.metadata && row.metadata) {
      byUser.set(row.userId, { ...existing, metadata: row.metadata, roleKey: row.roleKey ?? existing.roleKey });
    } else if (!existing.roleKey && row.roleKey) {
      byUser.set(row.userId, { ...existing, roleKey: row.roleKey });
    }
  }
  return [...byUser.values()];
}

function currentDesign(campaign: GreetingCampaign): GreetingDesignVersion | null {
  if (!campaign.currentDesignId) return campaign.designs[0] ?? null;
  return campaign.designs.find((d) => d.id === campaign.currentDesignId) ?? campaign.designs[0] ?? null;
}

export async function listGreetingCampaigns(claims: SessionClaims): Promise<{
  campaigns: GreetingCampaign[];
}> {
  return elevatedTx(async (tx) => {
    await requireRoot(claims);
    const store = await readStore(tx);
    return {
      campaigns: [...store.campaigns].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  });
}

export async function getGreetingCampaign(
  claims: SessionClaims,
  id: string,
): Promise<{ campaign: GreetingCampaign; estimate: GreetingAudienceEstimate }> {
  return elevatedTx(async (tx) => {
    await requireRoot(claims);
    const store = await readStore(tx);
    const campaign = store.campaigns.find((c) => c.id === id);
    if (!campaign) fail('greeting_not_found');
    const estimate = await estimateAudience(tx, campaign.audience);
    return { campaign, estimate };
  });
}

async function estimateAudience(
  tx: ElevatedTx,
  audience: GreetingAudience,
): Promise<GreetingAudienceEstimate> {
  const rows = await loadAudienceRows(tx);
  const matched = rows.filter((row) => matchesAudience(row, audience) && emailableAddress(row.email));
  return {
    matched: matched.length,
    sample: matched.slice(0, 5).map((row) => ({
      name: row.displayName,
      email: row.email,
      locale: row.locale,
    })),
  };
}

export type CreateGreetingInput = {
  occasion: string;
  occasionDate: string;
  meaning: string;
  audience?: GreetingAudience | undefined;
  /** Generate the first AI design immediately. */
  generateDesign?: boolean | undefined;
  changeRequest?: string | null | undefined;
};

export async function createGreetingCampaign(
  claims: SessionClaims,
  input: CreateGreetingInput,
): Promise<{ campaign: GreetingCampaign; estimate: GreetingAudienceEstimate }> {
  await elevatedTx(async (tx) => {
    await requireRoot(claims);
  });

  const occasion = input.occasion.trim().slice(0, 120);
  const occasionDate = input.occasionDate.trim().slice(0, 10);
  const meaning = input.meaning.trim().slice(0, 800);
  if (!occasion || !/^\d{4}-\d{2}-\d{2}$/.test(occasionDate) || !meaning) fail('invalid_body');

  let designs: GreetingDesignVersion[] = [];
  if (input.generateDesign !== false) {
    designs = [
      await generateGreetingDesign({
        occasion,
        occasionDate,
        meaning,
        changeRequest: input.changeRequest ?? null,
      }),
    ];
  }

  return elevatedTx(async (tx) => {
    await requireRoot(claims);
    const now = new Date().toISOString();
    const campaign: GreetingCampaign = {
      id: randomUUID(),
      occasion,
      occasionDate,
      meaning,
      audience: normalizeAudience(input.audience ?? emptyGreetingAudience()),
      status: 'draft',
      scheduledAt: null,
      sentAt: null,
      sentCount: 0,
      currentDesignId: designs[0]?.id ?? null,
      designs,
      createdAt: now,
      updatedAt: now,
      createdByUserId: claims.sub,
    };

    const store = await readStore(tx);
    store.campaigns = [campaign, ...store.campaigns].slice(0, MAX_CAMPAIGNS);
    await writeStore(tx, store, claims.sub);
    await tx.insert(auditLogs).values({
      organizationId: null,
      actorUserId: claims.sub,
      action: 'site.greeting.create',
      resourceType: 'greeting_campaign',
      resourceId: campaign.id,
      requestId: randomUUID(),
      metadata: { occasion, occasionDate },
    });
    return { campaign, estimate: await estimateAudience(tx, campaign.audience) };
  });
}

export type UpdateGreetingInput = {
  occasion?: string | undefined;
  occasionDate?: string | undefined;
  meaning?: string | undefined;
  audience?: GreetingAudience | undefined;
  status?: Extract<GreetingCampaignStatus, 'draft' | 'scheduled' | 'cancelled'> | undefined;
  scheduledAt?: string | null | undefined;
};

export async function updateGreetingCampaign(
  claims: SessionClaims,
  id: string,
  input: UpdateGreetingInput,
): Promise<{ campaign: GreetingCampaign; estimate: GreetingAudienceEstimate }> {
  return elevatedTx(async (tx) => {
    await requireRoot(claims);
    const store = await readStore(tx);
    const index = store.campaigns.findIndex((c) => c.id === id);
    if (index < 0) fail('greeting_not_found');
    const previous = store.campaigns[index]!;
    if (previous.status === 'sent' || previous.status === 'sending') fail('greeting_locked');

    const next: GreetingCampaign = {
      ...previous,
      occasion: input.occasion?.trim().slice(0, 120) || previous.occasion,
      occasionDate:
        input.occasionDate && /^\d{4}-\d{2}-\d{2}$/.test(input.occasionDate)
          ? input.occasionDate
          : previous.occasionDate,
      meaning: input.meaning?.trim().slice(0, 800) || previous.meaning,
      audience: input.audience ? normalizeAudience(input.audience) : previous.audience,
      updatedAt: new Date().toISOString(),
    };

    if (input.status === 'cancelled') {
      next.status = 'cancelled';
      next.scheduledAt = null;
    } else if (input.status === 'scheduled' || input.scheduledAt !== undefined) {
      const when =
        input.scheduledAt === null
          ? null
          : input.scheduledAt?.trim() || muscatNineAm(next.occasionDate);
      if (!when) fail('invalid_body');
      const at = new Date(when);
      if (Number.isNaN(at.getTime())) fail('invalid_body');
      next.scheduledAt = at.toISOString();
      next.status = 'scheduled';
    } else if (input.status === 'draft') {
      next.status = 'draft';
      next.scheduledAt = null;
    }

    store.campaigns[index] = next;
    await writeStore(tx, store, claims.sub);
    return { campaign: next, estimate: await estimateAudience(tx, next.audience) };
  });
}

export async function deleteGreetingCampaign(claims: SessionClaims, id: string): Promise<{ ok: true }> {
  return elevatedTx(async (tx) => {
    await requireRoot(claims);
    const store = await readStore(tx);
    const before = store.campaigns.length;
    store.campaigns = store.campaigns.filter((c) => c.id !== id);
    if (store.campaigns.length === before) fail('greeting_not_found');
    await writeStore(tx, store, claims.sub);
    return { ok: true as const };
  });
}

export async function redesignGreetingCampaign(
  claims: SessionClaims,
  id: string,
  changeRequest?: string | null,
): Promise<{ campaign: GreetingCampaign }> {
  const brief = await elevatedTx(async (tx) => {
    await requireRoot(claims);
    const store = await readStore(tx);
    const campaign = store.campaigns.find((c) => c.id === id);
    if (!campaign) fail('greeting_not_found');
    if (campaign.status === 'sending') fail('greeting_locked');
    return {
      occasion: campaign.occasion,
      occasionDate: campaign.occasionDate,
      meaning: campaign.meaning,
      avoidMotifs: campaign.designs.map((d) => d.motif).slice(0, 8),
    };
  });

  const design = await generateGreetingDesign({
    ...brief,
    changeRequest: changeRequest ?? null,
  });

  return elevatedTx(async (tx) => {
    await requireRoot(claims);
    const store = await readStore(tx);
    const index = store.campaigns.findIndex((c) => c.id === id);
    if (index < 0) fail('greeting_not_found');
    const campaign = store.campaigns[index]!;
    if (campaign.status === 'sending') fail('greeting_locked');

    const designs = [design, ...campaign.designs].slice(0, MAX_DESIGNS);
    const next: GreetingCampaign = {
      ...campaign,
      designs,
      currentDesignId: design.id,
      updatedAt: new Date().toISOString(),
    };
    store.campaigns[index] = next;
    await writeStore(tx, store, claims.sub);
    await tx.insert(auditLogs).values({
      organizationId: null,
      actorUserId: claims.sub,
      action: 'site.greeting.redesign',
      resourceType: 'greeting_campaign',
      resourceId: id,
      requestId: randomUUID(),
      metadata: { designId: design.id },
    });
    return { campaign: next };
  });
}

export async function selectGreetingDesign(
  claims: SessionClaims,
  id: string,
  designId: string,
): Promise<{ campaign: GreetingCampaign }> {
  return elevatedTx(async (tx) => {
    await requireRoot(claims);
    const store = await readStore(tx);
    const index = store.campaigns.findIndex((c) => c.id === id);
    if (index < 0) fail('greeting_not_found');
    const campaign = store.campaigns[index]!;
    if (!campaign.designs.some((d) => d.id === designId)) fail('greeting_design_not_found');
    const next = { ...campaign, currentDesignId: designId, updatedAt: new Date().toISOString() };
    store.campaigns[index] = next;
    await writeStore(tx, store, claims.sub);
    return { campaign: next };
  });
}

async function dispatchCampaign(
  tx: ElevatedTx,
  campaign: GreetingCampaign,
): Promise<{ sent: number }> {
  const design = currentDesign(campaign);
  if (!design) fail('greeting_no_design');

  const rows = (await loadAudienceRows(tx)).filter(
    (row) => matchesAudience(row, campaign.audience) && emailableAddress(row.email),
  );
  const imageUrl = greetingCardPublicUrl(campaign.id, design.id);
  let sent = 0;

  for (const row of rows.slice(0, SEND_BATCH)) {
    const locale = row.locale === 'en' ? 'en' : 'ar';
    const title = locale === 'ar' ? design.headlineAr : design.headlineEn;
    const body = locale === 'ar' ? design.bodyAr : design.bodyEn;
    const ok = await queueBrandedEmail(tx, {
      orgId: null,
      recipient: row.email,
      subject: `${title} · ${campaign.occasion}`.slice(0, 300),
      aggregateType: 'greeting_campaign',
      aggregateId: campaign.id,
      dedupeKey: `greeting:${campaign.id}:${row.userId}`,
      tone: 'reward',
      recipientName: row.displayName,
      title,
      intro: body,
      lines: [campaign.meaning.slice(0, 200)],
      details: [
        { label: locale === 'ar' ? 'المناسبة' : 'Occasion', value: campaign.occasion },
        { label: locale === 'ar' ? 'التاريخ' : 'Date', value: campaign.occasionDate },
      ],
      cta: { label: locale === 'ar' ? 'زيارة المنصة' : 'Visit BHD R', url: appLink('/ar') },
      footnote:
        locale === 'ar'
          ? 'بطاقة تهنئة من منصة BHD R · يمكنك حفظ الصورة من الرابط'
          : 'A greeting card from BHD R · you can save the image from the link',
      heroImageUrl: imageUrl,
    });
    if (ok) sent += 1;
  }
  return { sent };
}

export async function sendGreetingCampaignNow(
  claims: SessionClaims,
  id: string,
): Promise<{ campaign: GreetingCampaign; sent: number }> {
  const result = await elevatedTx(async (tx) => {
    await requireRoot(claims);
    const store = await readStore(tx);
    const index = store.campaigns.findIndex((c) => c.id === id);
    if (index < 0) fail('greeting_not_found');
    const campaign = store.campaigns[index]!;
    if (campaign.status === 'sending') fail('greeting_locked');
    if (!currentDesign(campaign)) fail('greeting_no_design');

    store.campaigns[index] = { ...campaign, status: 'sending', updatedAt: new Date().toISOString() };
    await writeStore(tx, store, claims.sub);

    const { sent } = await dispatchCampaign(tx, campaign);
    const next: GreetingCampaign = {
      ...campaign,
      status: 'sent',
      sentAt: new Date().toISOString(),
      sentCount: sent,
      scheduledAt: null,
      updatedAt: new Date().toISOString(),
    };
    store.campaigns[index] = next;
    await writeStore(tx, store, claims.sub);
    await tx.insert(auditLogs).values({
      organizationId: null,
      actorUserId: claims.sub,
      action: 'site.greeting.send',
      resourceType: 'greeting_campaign',
      resourceId: id,
      requestId: randomUUID(),
      metadata: { sent },
    });
    return { campaign: next, sent };
  });
  if (result.sent) sendQueuedEmailsSoon();
  return result;
}

/** Cron: dispatch due scheduled campaigns. */
export async function dispatchDueGreetingCampaigns(deadlineMs: number): Promise<{
  processed: number;
  sent: number;
}> {
  let processed = 0;
  let sentTotal = 0;
  await elevatedTx(async (tx) => {
    const store = await readStore(tx);
    const now = Date.now();
    for (let i = 0; i < store.campaigns.length; i += 1) {
      if (Date.now() > deadlineMs) break;
      const campaign = store.campaigns[i]!;
      if (campaign.status !== 'scheduled' || !campaign.scheduledAt) continue;
      if (new Date(campaign.scheduledAt).getTime() > now) continue;
      if (!currentDesign(campaign)) continue;

      store.campaigns[i] = { ...campaign, status: 'sending', updatedAt: new Date().toISOString() };
      await writeStore(tx, store, null);

      const { sent } = await dispatchCampaign(tx, campaign);
      store.campaigns[i] = {
        ...campaign,
        status: 'sent',
        sentAt: new Date().toISOString(),
        sentCount: sent,
        scheduledAt: null,
        updatedAt: new Date().toISOString(),
      };
      await writeStore(tx, store, null);
      processed += 1;
      sentTotal += sent;
    }
  });
  if (sentTotal) sendQueuedEmailsSoon();
  return { processed, sent: sentTotal };
}

export type GreetingDesignAsset = {
  body: Buffer;
  contentType: string;
};

/** Public image lookup (no auth) — raster preferred, SVG fallback. */
export async function loadGreetingDesignAsset(
  campaignId: string,
  designId: string,
): Promise<GreetingDesignAsset | null> {
  return elevatedTx(async (tx) => {
    const store = await readStore(tx);
    const campaign = store.campaigns.find((c) => c.id === campaignId);
    const design = campaign?.designs.find((d) => d.id === designId);
    if (!design) return null;
    if (design.imageBase64 && design.imageMime) {
      return {
        body: Buffer.from(design.imageBase64, 'base64'),
        contentType: design.imageMime,
      };
    }
    if (design.svg) {
      return { body: Buffer.from(design.svg, 'utf8'), contentType: 'image/svg+xml; charset=utf-8' };
    }
    return null;
  });
}

/** @deprecated use loadGreetingDesignAsset */
export async function loadGreetingDesignSvg(
  campaignId: string,
  designId: string,
): Promise<string | null> {
  const asset = await loadGreetingDesignAsset(campaignId, designId);
  if (!asset) return null;
  if (asset.contentType.startsWith('image/svg')) return asset.body.toString('utf8');
  return null;
}

export async function estimateGreetingAudience(
  claims: SessionClaims,
  audience: GreetingAudience,
): Promise<GreetingAudienceEstimate> {
  return elevatedTx(async (tx) => {
    await requireRoot(claims);
    return estimateAudience(tx, normalizeAudience(audience));
  });
}
