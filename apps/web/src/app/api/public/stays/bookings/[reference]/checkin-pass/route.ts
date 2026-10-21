import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { contractQrSvg } from '@/lib/contract-verify';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { guestStayCheckinPass } from '@/lib/stay-checkin-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(body: unknown, init?: ResponseInit) {
  return Response.json(body, init);
}

/** GET — guest arrival QR for a paid stay (reference is the guest key). */
export async function GET(
  request: Request,
  context: { params: Promise<{ reference: string }> },
) {
  if (!hasDatabaseUrl()) {
    return json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  const limited = assertRouteRateLimit({
    key: hashRateKey(['stay-checkin-pass', clientIp(request)]),
    limit: 40,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }
  const { reference } = await context.params;
  const locale = new URL(request.url).searchParams.get('locale') === 'en' ? 'en' : 'ar';
  try {
    const result = await guestStayCheckinPass(reference, locale);
    if (result.state !== 'pass') return json(result);
    const { token, ...pass } = result;
    // Encode the sealed token only — never a /stay-gate URL. Phone cameras show
    // opaque symbols; only the staff desk (login + stay.booking.manage) can redeem.
    return json({ ...pass, qrSvg: await contractQrSvg(token) });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'request_failed';
    const status = code === 'booking_not_found' ? 404 : 400;
    return json({ error: { code } }, { status });
  }
}
