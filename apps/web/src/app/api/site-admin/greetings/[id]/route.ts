import { z } from 'zod';
import {
  deleteGreetingCampaign,
  getGreetingCampaign,
  updateGreetingCampaign,
} from '@/lib/greeting-campaigns-neon';
import { requireLiveSession } from '@/lib/next-route-guard';
import { readJson, siteAdminRead, siteAdminRoute } from '@/lib/site-admin-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const audienceSchema = z
  .object({
    locales: z.array(z.enum(['ar', 'en'])).max(2),
    roles: z.array(z.enum(['all', 'tenant', 'owner', 'staff'])).max(4),
    nationalities: z.array(z.string().max(8)).max(12),
    genders: z.array(z.enum(['male', 'female'])).max(2),
    ages: z.array(z.enum(['youth', 'adult', 'senior'])).max(3),
  })
  .strict();

const patchSchema = z
  .object({
    occasion: z.string().min(1).max(120).optional(),
    occasionDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    meaning: z.string().min(1).max(800).optional(),
    audience: audienceSchema.optional(),
    status: z.enum(['draft', 'scheduled', 'cancelled']).optional(),
    scheduledAt: z.string().datetime().nullable().optional(),
  })
  .strict();

type Params = { params: Promise<{ id: string }> };

/** GET /api/site-admin/greetings/:id */
export function GET(request: Request, { params }: Params) {
  return siteAdminRead(request, 'GET /api/site-admin/greetings/:id', async (claims) => {
    const { id } = await params;
    return getGreetingCampaign(claims, id);
  });
}

/** PATCH /api/site-admin/greetings/:id */
export function PATCH(request: Request, { params }: Params) {
  return siteAdminRoute('PATCH /api/site-admin/greetings/:id', async () => {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    const { id } = await params;
    const body = await readJson(request, (value) => patchSchema.parse(value));
    return updateGreetingCampaign(claims, id, body);
  });
}

/** DELETE /api/site-admin/greetings/:id */
export function DELETE(request: Request, { params }: Params) {
  return siteAdminRoute('DELETE /api/site-admin/greetings/:id', async () => {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    const { id } = await params;
    return deleteGreetingCampaign(claims, id);
  });
}
