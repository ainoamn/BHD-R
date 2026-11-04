import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { elevatedTx } from '@/lib/elevated-db';
import { queueBrandedEmail } from '@/lib/email-notify';
import { sendQueuedEmailsSoon } from '@/lib/email-outbox';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import {
  MARKETPLACE_CITY_LABELS,
  type MarketplaceCity,
} from '@/lib/marketplace-directory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const cityIds = Object.keys(MARKETPLACE_CITY_LABELS) as [MarketplaceCity, ...MarketplaceCity[]];

const bodySchema = z
  .object({
    fullName: z.string().trim().min(2).max(160),
    email: z.string().trim().email().max(320),
    phone: z.string().trim().min(6).max(40).optional(),
    city: z.enum(cityIds),
    propertyType: z.enum(['apartment', 'villa', 'land', 'commercial', 'other']),
    notes: z.string().trim().max(2000).optional(),
    locale: z.enum(['ar', 'en']).default('ar'),
    consent: z.literal(true),
    website: z.string().optional(),
  })
  .strict();

function leadsInbox(): string | null {
  const raw =
    process.env.MARKETPLACE_LEADS_EMAIL?.trim() ||
    process.env.SUPPORT_EMAIL?.trim() ||
    process.env.OPS_NOTIFY_EMAIL?.trim() ||
    '';
  return raw && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw) ? raw : null;
}

/** POST /api/public/valuation-request — anonymous valuation lead. */
export async function POST(request: Request) {
  const limited = assertRouteRateLimit({
    key: hashRateKey(['valuation-request', clientIp(request)]),
    limit: 6,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }
  if (body.website) {
    return NextResponse.json({ accepted: true, reference: 'ok' });
  }

  const reference = `VAL-${randomUUID().slice(0, 8).toUpperCase()}`;
  const cityLabel = MARKETPLACE_CITY_LABELS[body.city];
  const inbox = leadsInbox();

  if (hasDatabaseUrl() && inbox) {
    try {
      let queued = false;
      await elevatedTx(async (tx) => {
        queued = await queueBrandedEmail(tx, {
          orgId: null,
          recipient: inbox,
          subject: `Valuation request ${reference} — ${body.fullName}`,
          aggregateType: 'marketplace.valuation_request',
          aggregateId: reference,
          tone: 'request',
          title: 'New property valuation request',
          intro: 'A visitor submitted a valuation request from the public marketplace.',
          details: [
            { label: 'Reference', value: reference },
            { label: 'Name', value: body.fullName },
            { label: 'Email', value: body.email },
            { label: 'Phone', value: body.phone ?? '—' },
            { label: 'City', value: `${cityLabel.en} / ${cityLabel.ar}` },
            { label: 'Property type', value: body.propertyType },
            { label: 'Notes', value: body.notes ?? '—' },
            { label: 'Locale', value: body.locale },
          ],
        });
      });
      if (queued) sendQueuedEmailsSoon();
    } catch {
      /* still accept the lead so the form stays usable */
    }
  }

  return NextResponse.json({ accepted: true, reference });
}
