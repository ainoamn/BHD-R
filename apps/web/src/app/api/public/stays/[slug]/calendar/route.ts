import { stayInventoryCalendarQuerySchema } from '@bhd-r/contracts';
import { getPublicStayCalendarOnNeon } from '@/lib/public-stays-booking-neon';
import {
  stayBookingDbGuard,
  stayBookingErrorResponse,
  stayBookingJson,
} from '@/lib/public-stays-booking-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const blocked = stayBookingDbGuard();
  if (blocked) return blocked;

  const { slug } = await context.params;
  const url = new URL(request.url);
  const parsed = stayInventoryCalendarQuerySchema.safeParse({
    fromOn: url.searchParams.get('fromOn'),
    toOn: url.searchParams.get('toOn'),
  });
  if (!parsed.success) {
    return stayBookingJson({ error: { code: 'invalid_query' } }, { status: 400 });
  }

  try {
    const payload = await getPublicStayCalendarOnNeon(slug, parsed.data);
    return stayBookingJson(payload);
  } catch (error) {
    return stayBookingErrorResponse(error);
  }
}
