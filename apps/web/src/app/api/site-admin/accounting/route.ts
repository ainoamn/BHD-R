import { z } from 'zod';
import { requireLiveSession } from '@/lib/next-route-guard';
import {
  createPlatformLedgerEntry,
  loadPlatformAccounting,
  voidPlatformLedgerEntry,
} from '@/lib/platform-accounting-neon';
import { PLATFORM_LEDGER_KINDS } from '@/lib/site-admin-shared';
import { siteAdminRead, siteAdminRoute } from '@/lib/site-admin-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const createSchema = z
  .object({
    kind: z.enum(PLATFORM_LEDGER_KINDS),
    category: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(500),
    amountOmr: z.number().positive().max(1_000_000_000),
    occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    organizationId: z.string().uuid().nullable().optional(),
    reference: z.string().trim().max(120).nullable().optional(),
  })
  .strict();

const voidSchema = z.object({ entryId: z.string().uuid(), void: z.literal(true) }).strict();

/** GET /api/site-admin/accounting — pulse, accounts, site ledger. */
export function GET(request: Request) {
  return siteAdminRead(request, 'GET /api/site-admin/accounting', async (claims) =>
    loadPlatformAccounting(claims),
  );
}

/** POST /api/site-admin/accounting — create a posted ledger entry or void one. */
export async function POST(request: Request) {
  return siteAdminRoute('POST /api/site-admin/accounting', async () => {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    const raw = await request.json().catch(() => null);
    let parsed:
      | { mode: 'void'; entryId: string }
      | {
          mode: 'create';
          kind: (typeof PLATFORM_LEDGER_KINDS)[number];
          category: string;
          description: string;
          amountOmr: number;
          occurredOn: string;
          organizationId: string | null;
          reference: string | null;
        };
    try {
      if (raw && typeof raw === 'object' && 'void' in (raw as object)) {
        const body = voidSchema.parse(raw);
        parsed = { mode: 'void', entryId: body.entryId };
      } else {
        const body = createSchema.parse(raw);
        parsed = {
          mode: 'create',
          kind: body.kind,
          category: body.category,
          description: body.description,
          amountOmr: body.amountOmr,
          occurredOn: body.occurredOn,
          organizationId: body.organizationId ?? null,
          reference: body.reference ?? null,
        };
      }
    } catch {
      throw new Error('invalid_body');
    }
    if (parsed.mode === 'void') {
      return { voided: await voidPlatformLedgerEntry(claims, parsed.entryId) };
    }
    return {
      entry: await createPlatformLedgerEntry(claims, parsed),
    };
  });
}
