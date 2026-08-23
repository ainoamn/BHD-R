import { z } from 'zod';
import { uuidSchema } from './schemas.js';

export const domainEventNames = [
  'property.created',
  'unit.created',
  'unit.availability.changed',
  'media.uploaded',
  'media.public-variant.ready',
  'lease.created',
  'contract.signature-requested',
  'contract.signed',
  'invoice.issued',
  'payment.recorded',
  'maintenance.created',
  'tenant.activation-requested',
  'notification.requested',
] as const;

export const domainEventNameSchema = z.enum(domainEventNames);

export const domainEventSchema = z.object({
  id: uuidSchema,
  name: domainEventNameSchema,
  aggregateId: uuidSchema,
  organizationId: uuidSchema,
  occurredAt: z.iso.datetime(),
  correlationId: z.string().min(1).max(200),
  actorId: uuidSchema.nullable(),
  version: z.number().int().positive(),
  payload: z.record(z.string(), z.unknown()),
});

export type DomainEventName = z.infer<typeof domainEventNameSchema>;
export type DomainEvent = z.infer<typeof domainEventSchema>;
