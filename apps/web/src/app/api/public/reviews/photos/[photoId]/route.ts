import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadReviewPhoto } from '@/lib/booking-reviews-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/;

/** GET /api/public/reviews/photos/:photoId — a photo attached to a published review. */
export async function GET(_request: Request, context: { params: Promise<{ photoId: string }> }) {
  if (!hasDatabaseUrl()) return new Response(null, { status: 503 });
  const { photoId } = await context.params;
  const dataUrl = await loadReviewPhoto(photoId).catch(() => null);
  const match = dataUrl ? DATA_URL.exec(dataUrl) : null;
  if (!match) return new Response(null, { status: 404 });
  return new Response(Buffer.from(match[2]!, 'base64'), {
    headers: {
      'content-type': match[1]!,
      'cache-control': 'public, max-age=86400, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}
