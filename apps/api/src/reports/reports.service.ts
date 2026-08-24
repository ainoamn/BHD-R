import { Injectable, NotFoundException } from '@nestjs/common';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  expenses,
  invoices,
  journalEntries,
  legalCases,
  maintenanceTickets,
  operationalRequests,
  outboxEvents,
  reportJobs,
  reservations,
  salesDeals,
  workTasks,
} from '@bhd-r/db';
import type { SessionClaims } from '@bhd-r/authz';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class ReportsService {
  readonly #s3 = new S3Client({
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    ...(process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY
      ? {
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY,
            secretAccessKey: process.env.S3_SECRET_KEY,
          },
        }
      : {}),
  });
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

  async download(claims: SessionClaims, id: string) {
    const row = await this.get(claims, id);
    if (
      row.status !== 'completed' ||
      !row.objectKey ||
      (row.expiresAt && row.expiresAt <= new Date())
    )
      throw new NotFoundException('Report file is not available');
    const expiresInSeconds = 180;
    const downloadUrl = await getSignedUrl(
      this.#s3,
      new GetObjectCommand({
        Bucket: process.env.S3_BUCKET_PRIVATE ?? 'bhd-r-private',
        Key: row.objectKey,
        ResponseContentDisposition: `attachment; filename="bhd-r-${row.type}-${row.id}.${row.format}"`,
      }),
      { expiresIn: expiresInSeconds },
    );
    return {
      downloadUrl,
      expiresInSeconds,
      fileName: `bhd-r-${row.type}-${row.id}.${row.format}`,
    };
  }

  operationalSummary(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const [
        requests,
        tasks,
        reservationsCount,
        sales,
        maintenance,
        legal,
        receivables,
        expenseTotal,
        draftJournals,
      ] = await Promise.all([
        transaction
          .select({ value: count() })
          .from(operationalRequests)
          .where(inArray(operationalRequests.status, ['pending', 'approved', 'in_progress'])),
        transaction
          .select({ value: count() })
          .from(workTasks)
          .where(inArray(workTasks.status, ['pending', 'approved', 'in_progress', 'on_hold'])),
        transaction
          .select({ value: count() })
          .from(reservations)
          .where(inArray(reservations.status, ['pending', 'confirmed'])),
        transaction
          .select({
            count: count(),
            valueMinor: sql<string>`coalesce(sum(${salesDeals.agreedPriceMinor}), 0)`,
          })
          .from(salesDeals)
          .where(
            inArray(salesDeals.status, [
              'lead',
              'qualified',
              'viewing',
              'offer',
              'negotiation',
              'reserved',
              'contracting',
            ]),
          ),
        transaction
          .select({ value: count() })
          .from(maintenanceTickets)
          .where(inArray(maintenanceTickets.status, ['open', 'assigned', 'in_progress'])),
        transaction
          .select({ value: count() })
          .from(legalCases)
          .where(
            inArray(legalCases.status, [
              'assessment',
              'notice',
              'filed',
              'hearing',
              'judgment',
              'enforcement',
              'settled',
            ]),
          ),
        transaction
          .select({
            valueMinor: sql<string>`coalesce(sum(${invoices.totalMinor} - ${invoices.paidMinor}), 0)`,
          })
          .from(invoices)
          .where(inArray(invoices.status, ['issued', 'partially_paid', 'overdue'])),
        transaction
          .select({
            valueMinor: sql<string>`coalesce(sum(${expenses.amountMinor} + ${expenses.taxMinor}), 0)`,
          })
          .from(expenses)
          .where(inArray(expenses.status, ['approved', 'in_progress', 'completed'])),
        transaction
          .select({ value: count() })
          .from(journalEntries)
          .where(eq(journalEntries.status, 'draft')),
      ]);
      return {
        generatedAt: new Date().toISOString(),
        currency: 'OMR',
        requests: { open: requests[0]?.value ?? 0 },
        tasks: { open: tasks[0]?.value ?? 0 },
        reservations: { active: reservationsCount[0]?.value ?? 0 },
        sales: {
          active: sales[0]?.count ?? 0,
          pipelineMinor: sales[0]?.valueMinor ?? '0',
        },
        maintenance: { open: maintenance[0]?.value ?? 0 },
        legal: { active: legal[0]?.value ?? 0 },
        accounting: {
          receivableMinor: receivables[0]?.valueMinor ?? '0',
          expenseMinor: expenseTotal[0]?.valueMinor ?? '0',
          draftJournals: draftJournals[0]?.value ?? 0,
        },
      };
    });
  }
}
