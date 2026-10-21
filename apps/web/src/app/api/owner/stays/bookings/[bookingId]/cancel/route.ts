import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { cancelOwnerStayBookingOnNeon } from '@/lib/owner-stay-cancel-neon';
import { REFUND_NOTE_MAX } from '@/lib/stay-deposit-refund';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const bodySchema = z
  .object({
    note: z.string().trim().min(3).max(REFUND_NOTE_MAX),
    refundDecision: z.enum(['refund', 'keep']).optional().nullable(),
  })
  .strict();

/**
 * POST /api/owner/stays/bookings/:bookingId/cancel
 * Cancel or reject a stay: reason note required; when paid, refund vs keep.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ bookingId: string }> },
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  const { bookingId } = await context.params;
  if (!z.string().uuid().safeParse(bookingId).success) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  let claims;
  try {
    claims = await requireLiveSession(request, {
      requireCsrf: true,
      anyPermission: ['stay.booking.manage'],
    });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  try {
    const result = await cancelOwnerStayBookingOnNeon(claims, bookingId, {
      note: body.note,
      refundDecision: body.refundDecision ?? null,
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'update_failed');
    if (code === 'update_failed') {
      console.error('POST /api/owner/stays/bookings/cancel', error);
    }
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
