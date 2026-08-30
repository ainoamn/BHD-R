import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { verifySessionToken } from '@bhd-r/authz';
import { createDatabase, properties, units } from '@bhd-r/db';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireSessionSecret } from '@/lib/runtime-env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  amountMinor: z.string().regex(/^\d+$/),
  currency: z.string().min(3).max(3).optional(),
});

function sessionSecret(): Uint8Array {
  return requireSessionSecret();
}

/** PATCH booking deposit for all units on a property. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ propertyId: string }> },
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  const token = (await cookies()).get('bhd_r_session')?.value;
  if (!token) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });

  let claims: Awaited<ReturnType<typeof verifySessionToken>>;
  try {
    claims = await verifySessionToken(token, sessionSecret());
  } catch {
    return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  }
  if (!claims.organizationId || !claims.permissions.includes('unit.update')) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  const { propertyId } = await context.params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  const { db } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
  const property = await db.query.properties.findFirst({
    where: and(
      eq(properties.id, propertyId),
      eq(properties.organizationId, claims.organizationId),
    ),
  });
  if (!property) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  if (property.status === 'archived') {
    return NextResponse.json({ error: { code: 'property_archived' } }, { status: 409 });
  }

  const unitRows = await db
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.propertyId, propertyId), eq(units.organizationId, claims.organizationId)));
  if (!unitRows.length) {
    return NextResponse.json({ error: { code: 'no_units' } }, { status: 404 });
  }

  await db
    .update(units)
    .set({
      depositMinor: BigInt(body.amountMinor),
      ...(body.currency ? { currency: body.currency as typeof units.$inferSelect.currency } : {}),
      updatedAt: new Date(),
    })
    .where(
      inArray(
        units.id,
        unitRows.map((row) => row.id),
      ),
    );

  return NextResponse.json({ ok: true, unitCount: unitRows.length });
}
