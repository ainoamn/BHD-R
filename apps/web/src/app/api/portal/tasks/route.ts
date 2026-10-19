import { z } from 'zod';
import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { legalErrorResponse, legalJson } from '@/lib/legal-case-route';
import { requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, hashRateKey } from '@/lib/route-rate-limit';
import { createWorkTask, listSubjectTasks, listWorkTasks } from '@/lib/work-task-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = [
  'pending',
  'approved',
  'in_progress',
  'on_hold',
  'cancelled',
  'rejected',
] as const;

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

const createSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    description: z.string().max(4000).optional(),
    priority: z.enum(PRIORITIES).optional(),
    status: z.enum(STATUSES).optional(),
    assignedToUserId: z.string().uuid().nullable().optional(),
    startsAt: z.string().max(32).nullable().optional(),
    dueAt: z.string().max(32).nullable().optional(),
    category: z.string().max(60).optional(),
    tags: z.array(z.string().max(40)).max(12).optional(),
    checklist: z.array(z.string().max(200)).max(40).optional(),
    propertyId: z.string().uuid().nullable().optional(),
    unitId: z.string().uuid().nullable().optional(),
  })
  .strict();

/** GET /api/portal/tasks — tasks the viewer may open. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request, { anyPermission: ['task.read'] });
    const url = new URL(request.url);
    const partyId = url.searchParams.get('partyId') ?? undefined;
    const propertyId = url.searchParams.get('propertyId') ?? undefined;
    const unitId = url.searchParams.get('unitId') ?? undefined;
    const uuid = /^[0-9a-f-]{36}$/i;
    if ((partyId && uuid.test(partyId)) || (propertyId && uuid.test(propertyId)) || (unitId && uuid.test(unitId))) {
      return legalJson({
        tasks: await listSubjectTasks(claims, {
          ...(partyId && uuid.test(partyId) ? { partyId } : {}),
          ...(propertyId && uuid.test(propertyId) && !unitId ? { propertyId } : {}),
          ...(unitId && uuid.test(unitId) ? { unitId } : {}),
        }),
      });
    }
    return legalJson({ tasks: await listWorkTasks(claims) });
  } catch (error) {
    return legalErrorResponse(error, 'load_failed');
  }
}

/** POST /api/portal/tasks — create a follow-up task. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request, {
      requireCsrf: true,
      anyPermission: ['task.create'],
    });
    const limited = assertRouteRateLimit({
      key: hashRateKey(['work-task-create', claims.sub]),
      limit: 30,
      windowMs: 60_000,
    });
    if (!limited.ok) return legalJson({ error: { code: 'rate_limited' } }, { status: 429 });
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return legalJson({ error: { code: 'invalid_body' } }, { status: 400 });
    const data = parsed.data;
    return legalJson(
      await createWorkTask(claims, {
        title: data.title,
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.assignedToUserId !== undefined ? { assignedToUserId: data.assignedToUserId } : {}),
        ...(data.startsAt !== undefined ? { startsAt: data.startsAt } : {}),
        ...(data.dueAt !== undefined ? { dueAt: data.dueAt } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.tags !== undefined ? { tags: data.tags } : {}),
        ...(data.checklist !== undefined ? { checklist: data.checklist } : {}),
        ...(data.propertyId !== undefined ? { propertyId: data.propertyId } : {}),
        ...(data.unitId !== undefined ? { unitId: data.unitId } : {}),
      }),
      { status: 201 },
    );
  } catch (error) {
    return legalErrorResponse(error, 'create_failed');
  }
}
