import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readLegalFile } from '@/lib/legal-case-neon';
import { legalErrorResponse, legalJson } from '@/lib/legal-case-route';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const uuid = z.string().uuid();

/** GET /api/portal/legal/cases/:caseId/files/:fileId — an attachment of the case. */
export async function GET(
  request: Request,
  context: { params: Promise<{ caseId: string; fileId: string }> },
) {
  const { caseId, fileId } = await context.params;
  if (!hasDatabaseUrl() || !uuid.safeParse(caseId).success || !uuid.safeParse(fileId).success) {
    return legalJson({ error: { code: 'not_found' } }, { status: 404 });
  }
  try {
    const claims = await requireLiveSession(request, {
      anyPermission: ['legal.read', 'legal.case.read'],
    });
    const found = await readLegalFile(claims, caseId, fileId);
    if (!found) return legalJson({ error: { code: 'not_found' } }, { status: 404 });
    const extension = found.mime === 'application/pdf' ? 'pdf' : found.mime.split('/')[1];
    const safeName = `${fileId.slice(0, 8)}.${extension}`;
    return new NextResponse(new Uint8Array(found.bytes), {
      headers: {
        'Content-Type': found.mime,
        'Content-Length': String(found.bytes.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `inline; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(found.name)}`,
        'Content-Security-Policy':
          "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      },
    });
  } catch (error) {
    return legalErrorResponse(error, 'load_failed');
  }
}
