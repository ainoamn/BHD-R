import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import {
  issueLeasingOpsReport,
  leasingReportFile,
  loadLeasingOpsReport,
} from '@/lib/leasing-report-neon';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const rowSchema = z
  .object({
    reference: z.string().max(120),
    property: z.string().max(200),
    unit: z.string().max(120),
    owner: z.string().max(200),
    tenant: z.string().max(200),
    state: z.string().max(80),
    startsOn: z.string().max(40),
    endsOn: z.string().max(40),
    rent: z.string().max(80),
  })
  .strict();

const postSchema = z
  .object({
    locale: z.enum(['ar', 'en']),
    title: z.string().trim().max(120).optional(),
    rows: z.array(rowSchema).min(1).max(500),
  })
  .strict();

/**
 * POST — seal the filtered leasing list as a verifiable report snapshot.
 * GET  — download Excel/CSV/PDF for a sealed token
 *        (`?token=&format=xlsx|csv|pdf&orientation=portrait|landscape`).
 */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  const limited = assertRouteRateLimit({
    key: hashRateKey(['leasing-report-issue', claims.sub, clientIp(request)]),
    limit: 20,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }
  try {
    const issued = await issueLeasingOpsReport(claims, {
      locale: parsed.data.locale,
      title:
        parsed.data.title ??
        (parsed.data.locale === 'ar' ? 'تقرير إدارة التأجير' : 'Leasing management report'),
      rows: parsed.data.rows,
    });
    return NextResponse.json(issued);
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error
        ? String((error as { code?: string }).code ?? error.message)
        : error instanceof Error
          ? error.message
          : 'request_failed';
    const status =
      code === 'forbidden' ? 403 : code === 'invalid_body' ? 400 : code === 'db_unconfigured' ? 503 : 500;
    return NextResponse.json({ error: { code } }, { status });
  }
}

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    await requireLiveSession(request, { requireCsrf: false });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? '';
  const formatParam = url.searchParams.get('format');
  const format =
    formatParam === 'csv' ? 'csv' : formatParam === 'pdf' ? 'pdf' : 'xlsx';
  const orientation =
    url.searchParams.get('orientation') === 'landscape' ? 'landscape' : 'portrait';
  const snapshot = await loadLeasingOpsReport(token);
  if (!snapshot) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  try {
    const file = await leasingReportFile(snapshot, format, orientation);
    return new NextResponse(Buffer.from(file.bytes), {
      status: 200,
      headers: {
        'content-type': file.mime,
        'content-disposition': `attachment; filename="${file.filename}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'render_failed';
    return NextResponse.json({ error: { code } }, { status: 500 });
  }
}
