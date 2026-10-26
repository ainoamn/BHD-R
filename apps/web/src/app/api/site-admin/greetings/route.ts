import { z } from 'zod';
import {
  createGreetingCampaign,
  estimateGreetingAudience,
  listGreetingCampaigns,
} from '@/lib/greeting-campaigns-neon';
import { emptyGreetingAudience } from '@/lib/greeting-campaigns-shared';
import { requireLiveSession } from '@/lib/next-route-guard';
import { siteAdminRead, siteAdminRoute } from '@/lib/site-admin-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const audienceSchema = z
  .object({
    locales: z.array(z.enum(['ar', 'en'])).max(2),
    roles: z.array(z.enum(['all', 'tenant', 'owner', 'staff'])).max(4),
    nationalities: z.array(z.string().max(8)).max(12),
    genders: z.array(z.enum(['male', 'female'])).max(2),
    ages: z.array(z.enum(['youth', 'adult', 'senior'])).max(3),
  })
  .strict();

const createSchema = z
  .object({
    occasion: z.string().min(1).max(120),
    occasionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** Optional notes — AI writes the ceremonial greeting. */
    meaning: z.string().max(800).optional().default(''),
    audience: audienceSchema.optional(),
    generateDesign: z.boolean().optional(),
    changeRequest: z.string().max(500).nullable().optional(),
  })
  .strict();

const estimateSchema = z.object({ audience: audienceSchema }).strict();

/** GET /api/site-admin/greetings */
export function GET(request: Request) {
  return siteAdminRead(request, 'GET /api/site-admin/greetings', (claims) =>
    listGreetingCampaigns(claims),
  );
}

/** POST /api/site-admin/greetings — create, or `{ estimate: true, audience }` for a count. */
export function POST(request: Request) {
  return siteAdminRoute('POST /api/site-admin/greetings', async () => {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    const oidcToken = request.headers.get('x-vercel-oidc-token');
    const raw = await request.json().catch(() => null);
    if (raw && typeof raw === 'object' && (raw as { estimate?: boolean }).estimate === true) {
      const body = estimateSchema.parse(raw);
      return {
        estimate: await estimateGreetingAudience(claims, body.audience ?? emptyGreetingAudience()),
      };
    }
    const body = createSchema.parse(raw);
    return createGreetingCampaign(claims, { ...body, oidcToken });
  });
}
