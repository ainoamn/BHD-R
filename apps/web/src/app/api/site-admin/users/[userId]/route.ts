import { z } from 'zod';
import { requireLiveSession } from '@/lib/next-route-guard';
import { setUserSuspended } from '@/lib/site-admin-neon';
import {
  getAdminUserDetail,
  revokeAdminUserSessions,
  sendAdminPasswordReset,
  unlockAdminUser,
  updateAdminUserPlan,
} from '@/lib/site-admin-users-neon';
import { SUBSCRIPTION_STATUSES } from '@/lib/site-admin-shared';
import { readJson, siteAdminRead, siteAdminRoute } from '@/lib/site-admin-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.union([
  z.object({ suspended: z.boolean() }).strict(),
  z.object({ action: z.literal('revoke_sessions') }).strict(),
  z.object({ action: z.literal('unlock') }).strict(),
  z.object({ action: z.literal('password_reset') }).strict(),
  z
    .object({
      action: z.literal('change_plan'),
      organizationId: z.string().uuid(),
      planKey: z.string().trim().min(1).max(40),
      status: z.enum(SUBSCRIPTION_STATUSES),
      endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      note: z.string().trim().max(200).nullable().optional(),
    })
    .strict(),
]);

/** GET /api/site-admin/users/:id — full dossier for one account. */
export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return siteAdminRead(request, 'GET /api/site-admin/users/:id', async (claims) => ({
    user: await getAdminUserDetail(claims, userId),
  }));
}

/** PATCH /api/site-admin/users/:id — suspend, unlock, reset password, revoke sessions, change plan. */
export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return siteAdminRoute('PATCH /api/site-admin/users', async () => {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    let body: z.infer<typeof bodySchema>;
    try {
      body = await readJson(request, (value) => bodySchema.parse(value));
    } catch {
      throw new Error('invalid_body');
    }
    if ('suspended' in body) {
      return { user: await setUserSuspended(claims, userId, body.suspended) };
    }
    if (body.action === 'revoke_sessions') {
      return { sessions: await revokeAdminUserSessions(claims, userId) };
    }
    if (body.action === 'unlock') {
      return { unlock: await unlockAdminUser(claims, userId) };
    }
    if (body.action === 'password_reset') {
      return { passwordReset: await sendAdminPasswordReset(claims, userId) };
    }
    return {
      plan: await updateAdminUserPlan(claims, userId, {
        organizationId: body.organizationId,
        planKey: body.planKey,
        status: body.status,
        endsOn: body.endsOn,
        note: body.note ?? null,
      }),
    };
  });
}
