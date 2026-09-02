import { stayAvailabilityQuerySchema } from '@bhd-r/contracts';
import { getPublicStayAvailabilityOnNeon } from '@/lib/public-stays-booking-neon';
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
  const parsed = stayAvailabilityQuerySchema.safeParse({
    checkInOn: url.searchParams.get('checkInOn'),
    checkOutOn: url.searchParams.get('checkOutOn'),
    adults: url.searchParams.get('adults') ?? '2',
    children: url.searchParams.get('children') ?? '0',
  });
  if (!parsed.success) {
    return stayBookingJson({ error: { code: 'invalid_query' } }, { status: 400 });
  }

  try {
    const payload = await getPublicStayAvailabilityOnNeon(slug, parsed.data);
    return stayBookingJson(payload);
  } catch (error) {
    return stayBookingErrorResponse(error);
  }
}
