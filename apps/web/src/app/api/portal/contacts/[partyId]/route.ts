import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readContact, updateContact } from '@/lib/contacts-neon';
import { contactErrorResponse, contactJson } from '@/lib/contacts-route';
import { CONTACT_ROLE_KEYS } from '@/lib/contacts-shared';
import { requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

type Context = { params: Promise<{ partyId: string }> };

const text = (max: number) => z.string().max(max);
const bodySchema = z
  .object({
    displayName: text(200).optional(),
    type: z.enum(['person', 'company']).optional(),
    email: text(320).nullable().optional(),
    phone: text(40).nullable().optional(),
    status: z.enum(['active', 'inactive', 'archived']).optional(),
    roles: z.array(z.enum(CONTACT_ROLE_KEYS)).max(CONTACT_ROLE_KEYS.length).optional(),
    notes: text(2_000).nullable().optional(),
    address: z
      .object({
        governorate: text(120),
        wilayat: text(120),
        city: text(120),
        area: text(120).nullable(),
        street: text(160).nullable(),
        buildingNumber: text(50).nullable(),
        postalCode: text(24).nullable(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

async function partyIdOf(params: Context['params']): Promise<string | null> {
  const { partyId } = await params;
  return z.string().uuid().safeParse(partyId).success ? partyId : null;
}

/** GET /api/portal/contacts/:partyId — the party, what links to them, and their money. */
export async function GET(request: Request, context: Context) {
  if (!hasDatabaseUrl())
    return contactJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  const partyId = await partyIdOf(context.params);
  if (!partyId) return contactJson({ error: { code: 'not_found' } }, { status: 404 });
  try {
    const claims = await requireLiveSession(request, { anyPermission: ['party.read'] });
    const found = await readContact(claims, partyId);
    if (!found) return contactJson({ error: { code: 'party_not_found' } }, { status: 404 });
    return contactJson(found);
  } catch (error) {
    return contactErrorResponse(error, 'load_failed');
  }
}

/** PATCH /api/portal/contacts/:partyId — details, roles, address and notes. */
export async function PATCH(request: Request, context: Context) {
  if (!hasDatabaseUrl())
    return contactJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  const partyId = await partyIdOf(context.params);
  if (!partyId) return contactJson({ error: { code: 'not_found' } }, { status: 404 });
  try {
    const claims = await requireLiveSession(request, {
      requireCsrf: true,
      anyPermission: ['party.write'],
    });
    const limited = assertRouteRateLimit({
      key: hashRateKey(['contact-update', claims.sub]),
      limit: 30,
      windowMs: 60_000,
    });
    if (!limited.ok) return contactJson({ error: { code: 'rate_limited' } }, { status: 429 });
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return contactJson({ error: { code: 'invalid_body' } }, { status: 400 });
    return contactJson(await updateContact(claims, partyId, parsed.data));
  } catch (error) {
    return contactErrorResponse(error, 'update_failed');
  }
}
