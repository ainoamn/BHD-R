import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { NOTE_TRANSLATE_MAX, noteLanguage, otherLanguage } from '@/lib/note-translation';
import { assistNote, translateNote } from '@/lib/note-translate-ai';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { assertViewingPassNoteAssist } from '@/lib/viewing-requests-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const tokenSchema = z.string().min(40).max(120);

const bodySchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('assist'),
      token: tokenSchema,
      text: z.string().trim().min(2).max(NOTE_TRANSLATE_MAX),
    })
    .strict(),
  z
    .object({
      action: z.literal('translate'),
      token: tokenSchema,
      text: z.string().trim().min(1).max(NOTE_TRANSLATE_MAX),
      target: z.enum(['ar', 'en']),
    })
    .strict(),
]);

/**
 * POST writing help for a guest note on an open viewing pass (token-gated):
 * live translation, correction and clearer rephrasing.
 */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['viewing-pass-assist', clientIp(request), body.token.slice(0, 24)]),
    limit: 30,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      {
        error: {
          code: 'rate_limited',
          messageAr: 'طلبات كثيرة خلال دقيقة — انتظر قليلاً.',
          message: 'Too many requests in a minute — wait a moment.',
        },
      },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  const context = { oidcToken: request.headers.get('x-vercel-oidc-token') };
  try {
    await assertViewingPassNoteAssist(body.token);
    if (body.action === 'translate') {
      return NextResponse.json(await translateNote(context, body), {
        headers: { 'cache-control': 'no-store' },
      });
    }
    const source = noteLanguage(body.text);
    const target = otherLanguage(source);
    const result = await assistNote(context, { text: body.text, source, target });
    return NextResponse.json(
      { ...result, source, target },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    const code = clientSafeErrorCode(error, 'request_failed');
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
