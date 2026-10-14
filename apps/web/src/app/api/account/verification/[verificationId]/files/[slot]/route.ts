import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { contactErrorResponse, contactJson } from '@/lib/contacts-route';
import { requireLiveSession } from '@/lib/next-route-guard';
import { readVerificationDocument } from '@/lib/verification-neon';
import { DOCUMENT_SLOTS, type DocumentSlot } from '@/lib/verification-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ verificationId: string; slot: string }> };

/** GET — a verification document, for its owner and the site administration only. */
export async function GET(request: Request, context: Context) {
  if (!hasDatabaseUrl())
    return contactJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  try {
    const claims = await requireLiveSession(request);
    const { verificationId, slot } = await context.params;
    if (!(DOCUMENT_SLOTS as readonly string[]).includes(slot))
      return contactJson({ error: { code: 'not_found' } }, { status: 404 });
    const file = await readVerificationDocument(claims, verificationId, slot as DocumentSlot);
    if (!file) return contactJson({ error: { code: 'not_found' } }, { status: 404 });
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        'content-type': file.mime,
        'cache-control': 'private, no-store',
        'content-security-policy':
          "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
        'x-content-type-options': 'nosniff',
        'content-disposition': 'inline',
      },
    });
  } catch (error) {
    return contactErrorResponse(error, 'load_failed');
  }
}
