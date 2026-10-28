import { NextResponse } from 'next/server';
import { z } from 'zod';
import { EMAIL_TONES } from '@/lib/email-template';
import {
  loadEmailWishPools,
  resetEmailWishPools,
  saveEmailWishPools,
} from '@/lib/email-wish-pools-neon';
import { readClaims } from '@/lib/portal-ops-data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const saveSchema = z.object({
  wishes: z.record(z.string(), z.array(z.string().max(400)).max(40)),
  sparks: z.array(z.string().max(400)).max(40),
  greetingsNamed: z.array(z.string().max(200)).max(40),
  greetingsAnon: z.array(z.string().max(200)).max(40),
});

export async function GET() {
  try {
    const claims = await readClaims();
    if (!claims) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    return NextResponse.json(await loadEmailWishPools(claims));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed';
    return NextResponse.json({ error: message }, { status: message === 'forbidden' ? 403 : 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const claims = await readClaims();
    if (!claims) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const body = saveSchema.parse(await request.json());
    for (const tone of EMAIL_TONES) {
      if (!Array.isArray(body.wishes[tone])) {
        return NextResponse.json({ error: `missing_tone:${tone}` }, { status: 400 });
      }
    }
    return NextResponse.json(await saveEmailWishPools(claims, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed';
    return NextResponse.json({ error: message }, { status: message === 'forbidden' ? 403 : 400 });
  }
}

export async function DELETE() {
  try {
    const claims = await readClaims();
    if (!claims) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    return NextResponse.json(await resetEmailWishPools(claims));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed';
    return NextResponse.json({ error: message }, { status: message === 'forbidden' ? 403 : 500 });
  }
}
