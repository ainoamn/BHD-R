import { z } from 'zod';
import {
  redesignGreetingCampaign,
  selectGreetingDesign,
  uploadGreetingDesign,
} from '@/lib/greeting-campaigns-neon';
import { requireLiveSession } from '@/lib/next-route-guard';
import { readJson, siteAdminRoute } from '@/lib/site-admin-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const bodySchema = z
  .object({
    /** Legacy AI redesign. */
    changeRequest: z.string().max(500).nullable().optional(),
    selectDesignId: z.string().uuid().optional(),
    /** Manual upload path. */
    upload: z
      .object({
        headlineAr: z.string().min(1).max(160),
        headlineEn: z.string().max(160).optional().default(''),
        bodyAr: z.string().min(1).max(800),
        bodyEn: z.string().max(800).optional().default(''),
        imageBase64: z.string().min(32).max(4_000_000),
        imageMime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        replaceCurrent: z.boolean().optional(),
      })
      .optional(),
  })
  .strict();

type Params = { params: Promise<{ id: string }> };

/** POST /api/site-admin/greetings/:id/design — upload, regenerate, or select a version. */
export function POST(request: Request, { params }: Params) {
  return siteAdminRoute('POST /api/site-admin/greetings/:id/design', async () => {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    const oidcToken = request.headers.get('x-vercel-oidc-token');
    const { id } = await params;
    const body = await readJson(request, (value) => bodySchema.parse(value));
    if (body.upload) {
      return uploadGreetingDesign(claims, id, {
        ...body.upload,
        headlineEn: body.upload.headlineEn || body.upload.headlineAr,
        bodyEn: body.upload.bodyEn || body.upload.bodyAr,
      });
    }
    if (body.selectDesignId) {
      return selectGreetingDesign(claims, id, body.selectDesignId);
    }
    return redesignGreetingCampaign(claims, id, body.changeRequest, oidcToken);
  });
}
