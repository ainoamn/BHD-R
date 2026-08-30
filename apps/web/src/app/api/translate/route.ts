import { NextResponse } from 'next/server';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';

type Body = {
  text?: string;
  target?: 'ar' | 'en';
};

async function translateChunk(chunk: string, target: 'ar' | 'en'): Promise<string | null> {
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
  const translated = payload.responseData?.translatedText?.trim();
  if (
    !translated ||
    payload.responseStatus !== 200 ||
    /MYMEMORY WARNING/i.test(translated)
  ) {
    return null;
  }
  return translated;
}

export async function POST(request: Request) {
  try {
    await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
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
  for (const chunk of chunks) {
    try {
      const translated = await translateChunk(chunk, target);
      parts.push(translated ?? chunk);
    } catch {
      parts.push(chunk);
    }
  }

  const joined = parts.join(' ').trim();
  return NextResponse.json({ translated: joined });
}
