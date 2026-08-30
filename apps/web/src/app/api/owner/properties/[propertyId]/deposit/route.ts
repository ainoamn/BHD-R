import { NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { createDatabase, properties, units, type Database } from '@bhd-r/db';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  amountMinor: z.string().regex(/^\d+$/),
  currency: z.string().min(3).max(3).optional(),
});

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

async function withinTenant<T>(
  claims: SessionClaims,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  const { db } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select set_config('app.organization_id', ${claims.organizationId ?? ''}, true)`,
    );
    await transaction.execute(sql`select set_config('app.user_id', ${claims.sub}, true)`);
    await transaction.execute(
      sql`select set_config('app.party_id', ${claims.partyId ?? ''}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.platform_admin', ${String(claims.roles.includes('platform_admin'))}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.is_tenant', ${String(claims.roles.includes('tenant'))}, true)`,
    );
    await transaction.execute(sql`select set_config('app.public', 'false', true)`);
    return work(transaction);
  });
}

/** PATCH booking deposit for all units on a property. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ propertyId: string }> },
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  let claims: SessionClaims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  if (!claims.organizationId || !claims.permissions.includes('unit.update')) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  const organizationId = claims.organizationId;
  const { propertyId } = await context.params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  try {
    const result = await withinTenant(claims, async (transaction) => {
      const property = await transaction.query.properties.findFirst({
        where: and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)),
      });
      if (!property) return { error: 'not_found' as const };
      if (property.status === 'archived') return { error: 'property_archived' as const };

      const unitRows = await transaction
        .select({ id: units.id })
        .from(units)
        .where(and(eq(units.propertyId, propertyId), eq(units.organizationId, organizationId)));
      if (!unitRows.length) return { error: 'no_units' as const };

      await transaction
        .update(units)
        .set({
          depositMinor: BigInt(body.amountMinor),
          ...(body.currency
            ? { currency: body.currency as typeof units.$inferSelect.currency }
            : {}),
          updatedAt: new Date(),
        })
        .where(
          inArray(
            units.id,
            unitRows.map((row) => row.id),
          ),
        );

      return { ok: true as const, unitCount: unitRows.length };
    });

    if ('error' in result) {
      const status = result.error === 'property_archived' ? 409 : 404;
      return NextResponse.json({ error: { code: result.error } }, { status });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('[deposit] update failed', error);
    return NextResponse.json({ error: { code: 'update_failed' } }, { status: 500 });
  }
}
