import { NextResponse } from 'next/server';
import { readContractAnnexPhoto, type AnnexPhotoKey } from '@/lib/contract-annex-neon';
import { HANDOVER_PHOTOS_MAX } from '@/lib/stay-handover';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const PORTALS = new Set(['owner', 'tenant', 'developer'] as const);

/**
 * GET /api/portal/contracts/:contractId/annex/:annex/photos/:index?portal=owner|tenant|developer
 * A unit condition photo of the check-in or check-out annex, for the contract's parties and staff.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ contractId: string; annex: string; index: string }> },
) {
  const { contractId, annex, index } = await context.params;
  const portalParam = new URL(request.url).searchParams.get('portal') ?? 'owner';
  const portal = PORTALS.has(portalParam as 'owner') ? (portalParam as 'owner') : null;
  const digit = /^\d$/.test(index) ? Number(index) : -1;
  const defect = /^defect-\d$/.test(index) ? Number(index.slice(7)) : -1;
  const photo: AnnexPhotoKey | null =
    digit >= 0 && digit < HANDOVER_PHOTOS_MAX
      ? digit
      : index === 'recipient'
        ? 'recipient'
        : defect >= 0 && defect < HANDOVER_PHOTOS_MAX
          ? `defect-${defect}`
          : null;
  if (!portal || (annex !== 'check-in' && annex !== 'check-out') || photo === null) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  const position = typeof photo === 'number' ? photo : index;

  try {
    const found = await readContractAnnexPhoto(contractId, portal, annex, photo);
    if (!found) {
      return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(found.bytes), {
      headers: {
        'Content-Type': found.mimeType,
        'Content-Length': String(found.bytes.length),
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `inline; filename="${annex}-photo-${typeof position === 'number' ? position + 1 : position}.${found.mimeType.split('/')[1]}"`,
      },
    });
  } catch (error) {
    console.error('GET /api/portal/contracts/annex/photos failed', error);
    return NextResponse.json({ error: { code: 'load_failed' } }, { status: 500 });
  }
}
