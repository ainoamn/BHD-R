import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { outboxEvents, reportJobs } from '@bhd-r/db';
import type { SessionClaims } from '@bhd-r/authz';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class ReportsService {
  constructor(private readonly database: DatabaseService) {}
  create(
    claims: SessionClaims,
    input: { type: string; format: string; filters: Record<string, unknown> },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .insert(reportJobs)
        .values({
          organizationId: claims.organizationId!,
          requestedByUserId: claims.sub,
          type: input.type,
          format: input.format,
          filters: input.filters,
        })
        .returning();
      await transaction.insert(outboxEvents).values({
        organizationId: claims.organizationId!,
        topic: 'report.requested',
        aggregateType: 'report_job',
        aggregateId: rows[0]!.id,
        payload: { type: input.type, format: input.format },
      });
      return rows[0];
    });
  }
  list(claims: SessionClaims) {
    return this.database.withinTenant(claims, (transaction) =>
      transaction
        .select()
        .from(reportJobs)
        .where(eq(reportJobs.organizationId, claims.organizationId!)),
    );
  }
  async get(claims: SessionClaims, id: string) {
    const row = await this.database.withinTenant(claims, (transaction) =>
      transaction.query.reportJobs.findFirst({
        where: and(eq(reportJobs.id, id), eq(reportJobs.organizationId, claims.organizationId!)),
      }),
    );
    if (!row) throw new NotFoundException('Report not found');
    return row;
  }
}
