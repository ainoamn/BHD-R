import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { contactErrorResponse, contactJson } from '@/lib/contacts-route';
import { requireLiveSession } from '@/lib/next-route-guard';
import { deleteProfileImage, saveProfileImage } from '@/lib/profile-image-neon';
import { assertRouteRateLimit, hashRateKey } from '@/lib/route-rate-limit';
import { AVATAR_MAX_INPUT_CHARS } from '@/lib/verification-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const subjectSchema = {
  subject: z.enum(['user', 'organization']),
  subjectId: z.string().uuid(),
};
const saveSchema = z
  .object({ ...subjectSchema, dataUrl: z.string().min(32).max(AVATAR_MAX_INPUT_CHARS) })
  .strict();
const deleteSchema = z.object(subjectSchema).strict();

/** POST /api/account/avatar — the account's picture or an organization's logo. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl())
    return contactJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  try {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    const limited = assertRouteRateLimit({
      key: hashRateKey(['avatar', claims.sub]),
      limit: 10,
      windowMs: 60_000,
    });
    if (!limited.ok) return contactJson({ error: { code: 'rate_limited' } }, { status: 429 });
    const parsed = saveSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return contactJson({ error: { code: 'avatar_invalid' } }, { status: 400 });
    const { subject, subjectId, dataUrl } = parsed.data;
    return contactJson(await saveProfileImage(claims, subject, subjectId, dataUrl));
  } catch (error) {
    return contactErrorResponse(error, 'upload_failed');
  }
}

/** DELETE /api/account/avatar — back to the initial letter. */
export async function DELETE(request: Request) {
  if (!hasDatabaseUrl())
    return contactJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  try {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return contactJson({ error: { code: 'invalid_body' } }, { status: 400 });
    return contactJson(
      await deleteProfileImage(claims, parsed.data.subject, parsed.data.subjectId),
    );
  } catch (error) {
    return contactErrorResponse(error, 'delete_failed');
  }
}
