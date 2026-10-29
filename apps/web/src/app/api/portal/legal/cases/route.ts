import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { listLegalCases } from '@/lib/legal-case-neon';
import { legalErrorResponse, legalJson } from '@/lib/legal-case-route';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

function preferNestFixtures(): boolean {
  return String(process.env['E2E_FORCE_NEST_FIXTURES'] ?? '').trim() === '1';
}

/** Playwright CI blanks DATABASE_URL; LegalCasesBoard listOverride does not use ops smoke rows. */
function e2eLegalCases() {
  return [
    {
      id: '00000000-0000-4000-8000-000000000014',
      reference: 'LEG-2026-0014',
      title: 'متابعة إشعار قانوني',
      caseType: 'notice',
      status: 'notice' as const,
      caseNumber: null,
      court: null,
      nextHearingAt: '2026-09-02T06:00:00.000Z',
      claimAmountMinor: '900000',
      recoveredAmountMinor: '0',
      currency: 'OMR',
      lawyerName: null,
      counterpartyName: null,
      propertyNameAr: 'عقار تجريبي',
      propertyNameEn: 'Sample property',
      unitCode: 'A-01',
      unread: 0,
      lastActivityAt: '2026-08-20T10:00:00.000Z',
    },
  ];
}

/** GET /api/portal/legal/cases — every case for the legal team, a lawyer's own cases for them. */
export async function GET(request: Request) {
  try {
    const claims = await requireLiveSession(request, {
      anyPermission: ['legal.read', 'legal.case.read'],
    });
    if (preferNestFixtures()) {
      return legalJson({ cases: e2eLegalCases() });
    }
    if (!hasDatabaseUrl()) return legalJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
    return legalJson({ cases: await listLegalCases(claims) });
  } catch (error) {
    return legalErrorResponse(error, 'load_failed');
  }
}
