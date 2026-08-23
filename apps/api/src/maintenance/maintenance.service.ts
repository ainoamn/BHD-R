import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { maintenanceTickets, outboxEvents, units } from '@bhd-r/db';
import type { SessionClaims } from '@bhd-r/authz';
import type { CreateMaintenanceTicketInput } from '@bhd-r/contracts';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class MaintenanceService {
  constructor(private readonly database: DatabaseService) {}

  create(claims: SessionClaims, input: CreateMaintenanceTicketInput) {
    return this.database.withinTenant(claims, async (transaction) => {
      const unit = await transaction.query.units.findFirst({
        where: and(eq(units.id, input.unitId), eq(units.organizationId, claims.organizationId!)),
      });
      if (!unit) throw new NotFoundException('Unit not found');
      const rows = await transaction
        .insert(maintenanceTickets)
        .values({
          organizationId: claims.organizationId!,
          unitId: input.unitId,
          openedByPartyId: claims.partyId,
          title: input.title,
          description: input.description,
          category: input.category,
          priority: input.priority,
        })
        .returning();
      await transaction.insert(outboxEvents).values({
        organizationId: claims.organizationId!,
        topic: 'maintenance.created',
        aggregateType: 'maintenance_ticket',
        aggregateId: rows[0]!.id,
        payload: { unitId: input.unitId, priority: input.priority },
      });
      return rows[0];
    });
  }

  list(claims: SessionClaims) {
    return this.database.withinTenant(claims, (transaction) =>
      transaction
        .select()
        .from(maintenanceTickets)
        .where(eq(maintenanceTickets.organizationId, claims.organizationId!)),
    );
  }

  update(
    claims: SessionClaims,
    id: string,
    input: {
      status: 'open' | 'assigned' | 'in_progress' | 'resolved' | 'closed' | 'cancelled';
      assignedToUserId?: string | undefined;
      blocksAvailability?: boolean | undefined;
    },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .update(maintenanceTickets)
        .set({
          status: input.status,
          assignedToUserId: input.assignedToUserId,
          blocksAvailability: input.blocksAvailability,
          resolvedAt: ['resolved', 'closed'].includes(input.status) ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(maintenanceTickets.id, id),
            eq(maintenanceTickets.organizationId, claims.organizationId!),
          ),
        )
        .returning();
      if (!rows[0]) throw new NotFoundException('Maintenance ticket not found');
      return rows[0];
    });
  }
}
