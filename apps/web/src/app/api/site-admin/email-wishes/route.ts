import { NextResponse } from 'next/server';
import { z } from 'zod';
import { EMAIL_TONES } from '@/lib/email-template';
import {
  loadEmailWishPools,
  resetEmailWishPools,
  saveEmailWishPools,
} from '@/lib/email-wish-pools-neon';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { requireLiveSession } from '@/lib/next-route-guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const saveSchema = z.object({
  wishes: z.record(z.string(), z.array(z.string().max(400)).max(40)),
  sparks: z.array(z.string().max(400)).max(40),
  greetingsNamed: z.array(z.string().max(200)).max(40),
  greetingsAnon: z.array(z.string().max(200)).max(40),
});

function failure(error: unknown) {
  const code = clientSafeErrorCode(error, 'request_failed');
  return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
}

export async function GET(request: Request) {
  try {
    const claims = await requireLiveSession(request);
    return NextResponse.json(await loadEmailWishPools(claims));
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request) {
  try {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    const body = saveSchema.parse(await request.json());
    for (const tone of EMAIL_TONES) {
      if (!Array.isArray(body.wishes[tone])) {
        return NextResponse.json({ error: { code: `missing_tone:${tone}` } }, { status: 400 });
      }
    }
    return NextResponse.json(await saveEmailWishPools(claims, body));
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    return NextResponse.json(await resetEmailWishPools(claims));
  } catch (error) {
    return failure(error);
  }
}
