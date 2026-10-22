import { z } from 'zod';
import { requireLiveSession } from '@/lib/next-route-guard';
import { PAYMENT_METHOD_IDS } from '@/lib/payment-gateways-catalog';
import {
  loadPaymentGateways,
  savePaymentGateway,
  savePaymentMethods,
} from '@/lib/site-control-neon';
import { readJson, siteAdminRead, siteAdminRoute } from '@/lib/site-admin-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const providerSchema = z
  .object({
    action: z.literal('provider'),
    providerId: z.string().min(2).max(80),
    active: z.boolean(),
    endpoint: z.string().max(500).optional(),
    credentials: z.record(z.string(), z.string().max(500)).optional(),
  })
  .strict();

const methodsSchema = z
  .object({
    action: z.literal('methods'),
    methods: z.record(z.enum(PAYMENT_METHOD_IDS), z.boolean()),
  })
  .strict();

const bodySchema = z.union([providerSchema, methodsSchema]);

/** GET /api/site-admin/payments — gateway + method flags for the console. */
export function GET(request: Request) {
  return siteAdminRead(request, 'GET /api/site-admin/payments', (claims) =>
    loadPaymentGateways(claims),
  );
}

/** PUT /api/site-admin/payments — save one gateway or the method toggles. */
export function PUT(request: Request) {
  return siteAdminRoute('PUT /api/site-admin/payments', async () => {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    const body = await readJson(request, (value) => bodySchema.parse(value));
    if (body.action === 'methods') {
      return savePaymentMethods(claims, { methods: body.methods });
    }
    return savePaymentGateway(claims, {
      providerId: body.providerId,
      active: body.active,
      ...(body.endpoint !== undefined ? { endpoint: body.endpoint } : {}),
      ...(body.credentials !== undefined ? { credentials: body.credentials } : {}),
    });
  });
}
