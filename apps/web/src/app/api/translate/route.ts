import { NextResponse } from 'next/server';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import {
  assertRouteRateLimit,
  clientIp,
  hashRateKey,
} from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 30;

type Body = {
  text?: string;
  target?: 'ar' | 'en';
};

function looksUseful(source: string, translated: string): boolean {
  const src = source.trim();
  const out = translated.trim();
  if (!out) return false;
  if (out.toLowerCase() === src.toLowerCase()) return false;
  if (/MYMEMORY WARNING/i.test(out)) return false;
  // Reject junk like "LC" for a long Arabic phrase.
  if (src.length >= 12 && out.length < Math.max(4, Math.floor(src.length * 0.25))) {
    return false;
  }
  return true;
}

async function translateViaGoogle(chunk: string, target: 'ar' | 'en'): Promise<string | null> {
  const sl = target === 'en' ? 'ar' : 'en';
  const url =
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}` +
    `&tl=${target}&dt=t&q=${encodeURIComponent(chunk)}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; BHD-R/1.0)',
    },
    signal: AbortSignal.timeout(12_000),
    cache: 'no-store',
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) return null;
  const text = payload[0]
    .map((row) => (Array.isArray(row) && typeof row[0] === 'string' ? row[0] : ''))
    .join('')
    .trim();
  return looksUseful(chunk, text) ? text : null;
}

async function translateViaMyMemory(chunk: string, target: 'ar' | 'en'): Promise<string | null> {
  const langpair = target === 'en' ? 'ar|en' : 'en|ar';
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${langpair}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
    cache: 'no-store',
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    responseData?: { translatedText?: string };
    responseStatus?: number;
  };
  const translated = payload.responseData?.translatedText?.trim() ?? '';
  if (payload.responseStatus !== 200 || !looksUseful(chunk, translated)) return null;
  return translated;
}

async function translateChunk(chunk: string, target: 'ar' | 'en'): Promise<string | null> {
  try {
    const viaGoogle = await translateViaGoogle(chunk, target);
    if (viaGoogle) return viaGoogle;
  } catch {
    /* try MyMemory */
  }
  try {
    return await translateViaMyMemory(chunk, target);
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let claims;
  try {
    // Session + same-origin is enough for this low-risk helper; CSRF double-submit
    // was racing Nest cookie overwrites and blocking legitimate owner edits.
    claims = await requireLiveSession(request, { requireCsrf: false });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['translate', claims.sub, clientIp(request)]),
    limit: 30,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const text = body.text?.trim() ?? '';
  const target = body.target;
  if (!text || (target !== 'ar' && target !== 'en')) {
    return NextResponse.json({ error: 'text and target (ar|en) required' }, { status: 400 });
  }
  if (text.length > 2000) {
    return NextResponse.json({ error: 'text too long' }, { status: 400 });
  }

  const chunks =
    text.length <= 450
      ? [text]
      : text
          .split(/(?<=[.!?؟。\n])\s+/)
          .reduce<string[]>((acc, part) => {
            const last = acc[acc.length - 1];
            if (last && last.length + part.length < 420) {
              acc[acc.length - 1] = `${last} ${part}`.trim();
            } else {
              acc.push(part.slice(0, 450));
            }
            return acc;
          }, []);

  const parts: string[] = [];
  let translatedAny = false;
  for (const chunk of chunks) {
    try {
      const translated = await translateChunk(chunk, target);
      if (translated) {
        parts.push(translated);
        translatedAny = true;
      } else {
        parts.push(chunk);
      }
    } catch {
      parts.push(chunk);
    }
  }

  const joined = parts.join(' ').trim();
  if (!translatedAny || !looksUseful(text, joined)) {
    return NextResponse.json(
      {
        error: 'translate_failed',
        message: 'Translation provider unavailable',
        messageAr: 'تعذّرت الترجمة حالياً',
      },
      { status: 502 },
    );
  }
  return NextResponse.json({ translated: joined });
}
