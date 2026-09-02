import { NextResponse } from 'next/server';
import { listGuestStayBookingsOnNeon } from '@/lib/public-stays-guest-neon';
import {
  stayBookingDbGuard,
  stayBookingErrorResponse,
  stayBookingJson,
} from '@/lib/public-stays-booking-route';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/public/stays/guest/mine — claimed bookings for signed-in user (Neon). */
export async function GET(request: Request) {
  const blocked = stayBookingDbGuard();
  if (blocked) return blocked;

  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: false });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  try {
    const payload = await listGuestStayBookingsOnNeon(claims.sub);
    return stayBookingJson(payload);
  } catch (error) {
    return stayBookingErrorResponse(error);
  }
}
