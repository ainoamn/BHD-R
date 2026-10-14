import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { contactErrorResponse, contactJson } from '@/lib/contacts-route';
import { requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, hashRateKey } from '@/lib/route-rate-limit';
import { submitVerification } from '@/lib/verification-neon';
import {
  BUSINESS_DOCUMENTS,
  DOCUMENT_MAX_CHARS,
  PERSONAL_DOCUMENTS,
  VERIFICATION_KINDS,
  VERIFICATION_PERIODS,
} from '@/lib/verification-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const file = z
  .string()
  .min(32)
  .max(DOCUMENT_MAX_CHARS * 2)
  .optional();
const bodySchema = z
  .object({
    kind: z.enum(VERIFICATION_KINDS),
    organizationId: z.string().uuid().nullable(),
    period: z.enum(VERIFICATION_PERIODS),
    legalNameAr: z.string().trim().max(200).nullable(),
    legalNameEn: z.string().trim().max(200).nullable(),
    documentType: z.enum([...PERSONAL_DOCUMENTS, ...BUSINESS_DOCUMENTS]),
    documentLast4: z.string().trim().max(4).nullable(),
    documentExpiresOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    documents: z.object({ front: file, back: file, selfie: file, registration: file }).strict(),
  })
  .strict();

/** POST /api/account/verification — documents for a personal or business verification. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl())
    return contactJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  try {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    const limited = assertRouteRateLimit({
      key: hashRateKey(['verification-submit', claims.sub]),
      limit: 5,
      windowMs: 10 * 60_000,
    });
    if (!limited.ok) return contactJson({ error: { code: 'rate_limited' } }, { status: 429 });
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return contactJson({ error: { code: 'verification_invalid' } }, { status: 400 });
    const { documents, ...rest } = parsed.data;
    return contactJson(
      await submitVerification(claims, {
        ...rest,
        documents: Object.fromEntries(
          Object.entries(documents).filter((entry): entry is [string, string] => !!entry[1]),
        ),
      }),
      { status: 201 },
    );
  } catch (error) {
    return contactErrorResponse(error, 'create_failed');
  }
}
