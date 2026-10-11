import { NextResponse } from 'next/server';
import { readContractFile } from '@/lib/contract-detail-neon';
import { CONTRACT_FILE_FIELDS, type ContractFileKind } from '@/lib/contract-document';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const PORTALS = new Set(['owner', 'tenant', 'developer'] as const);

/**
 * GET /api/portal/contracts/:contractId/files/:file?portal=owner|tenant|developer
 * Electronic-signature captures attached to a contract (signature, ID front/back, selfie).
 * ID photos and selfie are limited to the tenant themself and staff who manage stay bookings.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ contractId: string; file: string }> },
) {
  const { contractId, file } = await context.params;
  const portalParam = new URL(request.url).searchParams.get('portal') ?? 'owner';
  const portal = PORTALS.has(portalParam as 'owner') ? (portalParam as 'owner') : null;
  if (!portal || !Object.hasOwn(CONTRACT_FILE_FIELDS, file)) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  try {
    const found = await readContractFile(contractId, portal, file as ContractFileKind);
    if (!found) {
      return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(found.bytes), {
      headers: {
        'Content-Type': found.mimeType,
        'Content-Length': String(found.bytes.length),
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `inline; filename="${file}.${found.mimeType.split('/')[1]}"`,
      },
    });
  } catch (error) {
    console.error('GET /api/portal/contracts/files failed', error);
    return NextResponse.json({ error: { code: 'load_failed' } }, { status: 500 });
  }
}
